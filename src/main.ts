import { App, Modal, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_TOOL_STATE, Palette, ToolState } from './palette';
import { DEFAULT_SETTINGS, JotSettings, JotSettingTab } from './settings';
import {
	drawHighlighterPolyline,
	drawSegment,
	drawStroke,
	ERASE_RADIUS,
	NormalizedPoint,
	Stroke,
	strokeIntersects,
} from './strokes';
import { ExportChoiceModal, drawStrokesOnPdfPage } from './merge';

export type { Handedness } from './palette';

const PLUGIN_LOG = '[jot]';
const OVERLAY_CLASS = 'jot-overlay';
const PAGE_ANCHOR_CLASS = 'jot-page-anchor';
const PASSTHROUGH_CLASS = 'jot-passthrough';
const OVERLAY_KEY_ATTR = 'data-jot-key';
const PAGE_OBSERVED_ATTR = 'data-jot-observed';
// Stationary press duration before the palette pops, and the movement
// tolerance for what counts as "stationary" in screen pixels. The tolerance
// needs to be generous on iPad: Apple Pencil reports high-frequency samples
// with natural jitter, so 5 px almost always tripped before the timer fired.
const LONG_PRESS_MS = 300;
const LONG_PRESS_MOVE_PX = 15;
// Two-finger stationary hold as an alternative palette trigger — useful when
// the pen isn't in the user's hand. More generous movement tolerance than
// the pen because fingers are less precise.
const TWO_FINGER_HOLD_MS = 300;
const TWO_FINGER_MOVE_PX = 25;
// Per-PDF cap on the undo stack so a long session can't unbound memory.
const MAX_UNDO_DEPTH = 50;
const INK_SUFFIX = '.ink.json';
const SAVE_DEBOUNCE_MS = 250;
const INK_FORMAT_VERSION = 2;

interface InkFileFormat {
	version: number;
	pages: Record<string, Stroke[]>;
}

const pageKey = (filePath: string, pageNumber: number) =>
	`${filePath}::${pageNumber}`;

function filePathFromKey(key: string): string | null {
	const idx = key.lastIndexOf('::');
	if (idx < 0) return null;
	return key.slice(0, idx);
}

export default class JotPlugin extends Plugin {
	private containerObservers = new Map<WorkspaceLeaf, MutationObserver>();
	private strokes = new Map<string, Stroke[]>();
	private saveTimers = new Map<string, number>();
	// Sidecar paths we wrote ourselves, with a timestamp. The vault.on(
	// 'modify') watcher checks this to suppress reload-on-our-own-save.
	private recentSelfSaves = new Map<string, number>();
	private toolState: ToolState = { ...DEFAULT_TOOL_STATE };
	private palette!: Palette;
	settings: JotSettings = { ...DEFAULT_SETTINGS };
	private undoStacks = new Map<string, UndoEntry[]>();
	private redoStacks = new Map<string, UndoEntry[]>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new JotSettingTab(this.app, this));
		this.addCommand({
			id: 'merge-notes-into-pdf',
			name: 'Merge notes into PDF',
			checkCallback: (checking) => {
				const path = this.getActivePdfFilePath();
				if (!path) return false;
				if (!checking) void this.startMergeFlow(path);
				return true;
			},
		});
		this.addCommand({
			id: 'clear-annotations',
			name: 'Clear annotations on this PDF',
			checkCallback: (checking) => {
				const path = this.getActivePdfFilePath();
				if (!path) return false;
				if (!this.pdfHasStrokes(path)) return false;
				if (!checking) this.startClearFlow(path);
				return true;
			},
		});
		this.palette = new Palette(
			this.toolState,
			(state) => {
				this.toolState = state;
				this.settings.toolState = state;
				void this.saveSettings();
			},
			{
				onUndo: () => this.undoActivePdf(),
				onRedo: () => this.redoActivePdf(),
				canUndo: () => this.canUndoActivePdf(),
				canRedo: () => this.canRedoActivePdf(),
			},
		);

		this.registerEvent(
			this.app.workspace.on('file-open', async (file: TFile | null) => {
				if (file?.extension !== 'pdf') return;
				await this.ensureLoaded(file.path);
				window.setTimeout(() => this.attachOverlayToActivePdfView(), 300);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.pruneClosedLeafObservers();
				this.attachOverlayToActivePdfView();
			}),
		);

		// Reload the sidecar when an external change arrives (Obsidian Sync,
		// iCloud, etc. push a new .ink.json). Filters to our sidecar files
		// and skips events triggered by our own writes via the recent-self-
		// write timestamp set in saveToDisk.
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!file.path.endsWith(INK_SUFFIX)) return;
				const lastSelf = this.recentSelfSaves.get(file.path);
				if (lastSelf !== undefined && Date.now() - lastSelf < 1500) {
					this.recentSelfSaves.delete(file.path);
					return;
				}
				const pdfPath = file.path.slice(0, -INK_SUFFIX.length);
				void this.reloadSidecar(pdfPath);
			}),
		);

		// Pick up an already-open PDF on plugin enable / Obsidian restart.
		this.app.workspace.onLayoutReady(async () => {
			const filePath = this.getActivePdfFilePath();
			if (!filePath) return;
			await this.ensureLoaded(filePath);
			this.attachOverlayToActivePdfView();
		});
	}

	onunload() {
		this.containerObservers.forEach((o) => o.disconnect());
		this.containerObservers.clear();
		this.saveTimers.forEach((id) => window.clearTimeout(id));
		this.saveTimers.clear();
		this.palette?.hide();
	}

	private inkPathFor(pdfPath: string): string {
		return pdfPath + INK_SUFFIX;
	}

	private async ensureLoaded(pdfPath: string) {
		// Always re-read from disk. An in-memory cache here masked external
		// updates (Obsidian Sync etc.) — once a PDF had been loaded, the
		// previous code never reloaded it, so even closing and reopening the
		// PDF still showed stale strokes until the plugin restarted.
		await this.loadFromDisk(pdfPath);
	}

	private async loadFromDisk(pdfPath: string) {
		const path = this.inkPathFor(pdfPath);
		// Drop any stale in-memory strokes for this PDF before repopulating
		// from the file, so an erased page becomes empty on reload instead
		// of keeping its old strokes around in the Map.
		const prefix = pdfPath + '::';
		for (const key of [...this.strokes.keys()]) {
			if (key.startsWith(prefix)) this.strokes.delete(key);
		}
		try {
			if (!(await this.app.vault.adapter.exists(path))) return;
			const text = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(text) as InkFileFormat;
			if (parsed.version !== INK_FORMAT_VERSION && parsed.version !== 1) {
				console.warn(
					`${PLUGIN_LOG} ${path} has unknown version ${parsed.version}, skipping`,
				);
				return;
			}
			for (const [pageNumStr, strokes] of Object.entries(parsed.pages)) {
				const pageNumber = parseInt(pageNumStr, 10);
				if (Number.isNaN(pageNumber)) continue;
				// v1 strokes have no `tool` field — treat them as pen.
				const upgraded: Stroke[] = strokes.map((s) => {
					const legacy = s as Partial<Stroke>;
					return {
						points: s.points,
						color: s.color,
						width: s.width,
						tool: legacy.tool ?? 'pen',
					};
				});
				this.strokes.set(pageKey(pdfPath, pageNumber), upgraded);
			}
		} catch (err) {
			console.error(`${PLUGIN_LOG} loadFromDisk failed for ${path}:`, err);
		}
	}

	private async saveToDisk(pdfPath: string) {
		const pages: Record<string, Stroke[]> = {};
		const prefix = pdfPath + '::';
		for (const [key, strokes] of this.strokes.entries()) {
			if (!key.startsWith(prefix)) continue;
			if (strokes.length === 0) continue;
			pages[key.slice(prefix.length)] = strokes;
		}
		const path = this.inkPathFor(pdfPath);
		try {
			if (Object.keys(pages).length === 0) {
				if (await this.app.vault.adapter.exists(path)) {
					await this.app.vault.adapter.remove(path);
				}
				return;
			}
			const payload: InkFileFormat = {
				version: INK_FORMAT_VERSION,
				pages,
			};
			await this.app.vault.adapter.write(
				path,
				JSON.stringify(payload, null, 2),
			);
			this.recentSelfSaves.set(path, Date.now());
		} catch (err) {
			console.error(`${PLUGIN_LOG} saveToDisk failed for ${path}:`, err);
		}
	}

	private async reloadSidecar(pdfPath: string) {
		await this.loadFromDisk(pdfPath);
		// Redraw every open canvas for this PDF so the live view picks up
		// the externally-applied changes without needing a tab close.
		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as { file?: TFile }).file;
			if (file?.path !== pdfPath) return;
			leaf.view.containerEl
				.querySelectorAll<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`)
				.forEach((canvas) => this.redrawPage(canvas));
		});
	}

	private scheduleSave(pdfPath: string) {
		const existing = this.saveTimers.get(pdfPath);
		if (existing !== undefined) window.clearTimeout(existing);
		const id = window.setTimeout(() => {
			this.saveTimers.delete(pdfPath);
			void this.saveToDisk(pdfPath);
		}, SAVE_DEBOUNCE_MS);
		this.saveTimers.set(pdfPath, id);
	}

	private getActivePdfLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return null;
		const viewType = leaf.view.getViewType?.();
		if (viewType !== 'pdf') return null;
		return leaf;
	}

	private getActivePdfFilePath(): string | null {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return null;
		const file = (leaf.view as { file?: TFile }).file;
		return file?.path ?? null;
	}

	private pruneClosedLeafObservers() {
		if (this.containerObservers.size === 0) return;
		const live = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => live.add(leaf));
		for (const [leaf, observer] of this.containerObservers) {
			if (!live.has(leaf)) {
				observer.disconnect();
				this.containerObservers.delete(leaf);
			}
		}
	}

	private attachOverlayToActivePdfView() {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return;
		const filePath = this.getActivePdfFilePath();
		if (!filePath) return;
		const container = leaf.view.containerEl;

		this.upgradePages(container, filePath);

		// One container observer per leaf — looks up the leaf's current file
		// path at fire time so it stays correct when the user navigates within
		// the same leaf. Without this guard, layout-change would attach a fresh
		// observer on every call and the accumulated set would freeze the UI.
		if (this.containerObservers.has(leaf)) return;
		const obs = new MutationObserver(() => {
			const currentPath = this.filePathForLeaf(leaf);
			if (!currentPath) return;
			this.upgradePages(container, currentPath);
		});
		obs.observe(container, { childList: true, subtree: true });
		this.containerObservers.set(leaf, obs);
	}

	private filePathForLeaf(leaf: WorkspaceLeaf): string | null {
		const file = (leaf.view as { file?: TFile }).file;
		return file?.path ?? null;
	}

	private upgradePages(container: HTMLElement, filePath: string) {
		const pages = container.querySelectorAll<HTMLElement>('.page');
		pages.forEach((page) => this.ensureOverlayOnPage(page, filePath));
	}

	private ensureOverlayOnPage(page: HTMLElement, filePath: string) {
		const pageNumberAttr = page.getAttribute('data-page-number');
		const pageNumber = pageNumberAttr ? parseInt(pageNumberAttr, 10) : NaN;
		if (Number.isNaN(pageNumber)) return;
		const key = pageKey(filePath, pageNumber);

		const existing = page.querySelector<HTMLCanvasElement>(
			`canvas.${OVERLAY_CLASS}`,
		);
		if (existing) {
			if (existing.getAttribute(OVERLAY_KEY_ATTR) === key) {
				this.sizeOverlayToPage(existing, page);
				this.redrawPage(existing);
				return;
			}
			// Stale overlay from a previous PDF — drop it and build fresh so
			// the wired event handlers reference the current file's key.
			existing.remove();
		}

		// PDF.js doesn't guarantee .page has a positioned context; this class
		// applies position:relative so our absolutely-positioned overlay anchors
		// to the page rather than to an ancestor.
		page.classList.add(PAGE_ANCHOR_CLASS);

		const overlay = activeDocument.createElement('canvas');
		overlay.className = OVERLAY_CLASS;
		overlay.setAttribute(OVERLAY_KEY_ATTR, key);
		// touch-action stays at the default 'auto' so finger touches scroll
		// the PDF view normally; we ignore them at the pointerdown handler.
		// Apple Pencil fires pointerType='pen' which is not affected by
		// touch-action.

		this.sizeOverlayToPage(overlay, page);
		page.appendChild(overlay);

		this.disableTextLayerInteraction(page);
		this.wirePointerEvents(overlay);
		this.redrawPage(overlay);

		// Page-level observers are at most one per .page element across the
		// plugin's lifetime — guarded by a data attribute so they don't pile
		// up when overlays are replaced for a different PDF.
		if (page.getAttribute(PAGE_OBSERVED_ATTR) === '1') return;
		page.setAttribute(PAGE_OBSERVED_ATTR, '1');

		const findOverlay = () =>
			page.querySelector<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`);

		new MutationObserver(() => {
			const current = findOverlay();
			if (!current) return;
			this.disableTextLayerInteraction(page);
			if (!page.contains(current)) {
				this.sizeOverlayToPage(current, page);
				page.appendChild(current);
				this.redrawPage(current);
			}
		}).observe(page, { childList: true });

		new ResizeObserver(() => {
			const current = findOverlay();
			if (!current) return;
			this.sizeOverlayToPage(current, page);
			this.redrawPage(current);
		}).observe(page);
	}

	private sizeOverlayToPage(overlay: HTMLCanvasElement, page: HTMLElement) {
		const rect = page.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const targetW = Math.round(rect.width);
		const targetH = Math.round(rect.height);
		if (overlay.width !== targetW) overlay.width = targetW;
		if (overlay.height !== targetH) overlay.height = targetH;
		overlay.setCssStyles({
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});
	}

	private disableTextLayerInteraction(page: HTMLElement) {
		page.querySelector<HTMLElement>('.textLayer')?.classList.add(
			PASSTHROUGH_CLASS,
		);
		page.querySelector<HTMLElement>('.annotationLayer')?.classList.add(
			PASSTHROUGH_CLASS,
		);
	}

	private redrawPage(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return;
		const strokes = this.strokes.get(key);
		if (!strokes || strokes.length === 0) return;
		for (const stroke of strokes) {
			drawStroke(ctx, stroke, canvas.width, canvas.height);
		}
	}

	private wirePointerEvents(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			console.error(`${PLUGIN_LOG} no 2d context`);
			return;
		}

		// On iPadOS, the OS-level gesture recognizer runs at the legacy
		// touch-event layer. Without this, a long Apple Pencil stroke gets
		// reinterpreted as a scroll partway through, cancelling our pointer
		// capture. preventDefault on touchstart/move for stylus touches stops
		// the preemption; finger touches are left alone so they still scroll
		// the PDF view normally.
		const blockStylusGesture = (e: TouchEvent) => {
			for (let i = 0; i < e.touches.length; i++) {
				const t = e.touches.item(i) as Touch & { touchType?: string };
				if (t?.touchType === 'stylus') {
					e.preventDefault();
					return;
				}
			}
		};
		canvas.addEventListener('touchstart', blockStylusGesture, { passive: false });
		canvas.addEventListener('touchmove', blockStylusGesture, { passive: false });

		let inProgress: NormalizedPoint[] | null = null;
		let eraserActive = false;
		let eraseSnapshot: UndoEntry | null = null;
		let eraseTouched = false;
		let downPoint: { clientX: number; clientY: number } | null = null;
		let longPressTimer: number | null = null;
		let activePointerId: number | null = null;
		let holdIndicator: HTMLElement | null = null;
		let twoFingerIndicator: HTMLElement | null = null;
		// Finger tracker for the two-finger hold gesture. Keyed by pointerId.
		const activeTouches = new Map<number, {
			clientX: number;
			clientY: number;
			downX: number;
			downY: number;
		}>();
		let twoFingerTimer: number | null = null;

		const removeHoldIndicator = () => {
			if (holdIndicator) {
				holdIndicator.remove();
				holdIndicator = null;
			}
		};
		const removeTwoFingerIndicator = () => {
			if (twoFingerIndicator) {
				twoFingerIndicator.remove();
				twoFingerIndicator = null;
			}
		};

		const cancelLongPress = () => {
			if (longPressTimer !== null) {
				window.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
			removeHoldIndicator();
		};

		const cancelTwoFinger = () => {
			if (twoFingerTimer !== null) {
				window.clearTimeout(twoFingerTimer);
				twoFingerTimer = null;
			}
			removeTwoFingerIndicator();
		};

		const toNormalized = (e: PointerEvent): NormalizedPoint => {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (e.clientX - rect.left) / rect.width,
				y: (e.clientY - rect.top) / rect.height,
				pressure: e.pressure,
			};
		};

		canvas.addEventListener('pointerdown', (e) => {
			// Finger touch: track for the two-finger-hold gesture, otherwise
			// pass through so it can scroll the PDF view underneath.
			if (e.pointerType === 'touch') {
				activeTouches.set(e.pointerId, {
					clientX: e.clientX,
					clientY: e.clientY,
					downX: e.clientX,
					downY: e.clientY,
				});
				cancelTwoFinger();
				if (
					activeTouches.size === 2 &&
					!this.palette.isOpen() &&
					inProgress === null &&
					!eraserActive
				) {
					const pts = [...activeTouches.values()];
					const p0 = pts[0];
					const p1 = pts[1];
					if (p0 && p1) {
						const initialCx = (p0.clientX + p1.clientX) / 2;
						const initialCy = (p0.clientY + p1.clientY) / 2;
						twoFingerIndicator = createHoldIndicator(
							activeDocument,
							initialCx,
							initialCy,
							TWO_FINGER_HOLD_MS,
						);
						activeDocument.body.appendChild(twoFingerIndicator);
					}
					twoFingerTimer = window.setTimeout(() => {
						twoFingerTimer = null;
						removeTwoFingerIndicator();
						if (activeTouches.size !== 2) return;
						if (this.palette.isOpen()) return;
						const pts2 = [...activeTouches.values()];
						const q0 = pts2[0];
						const q1 = pts2[1];
						if (!q0 || !q1) return;
						const cx = (q0.clientX + q1.clientX) / 2;
						const cy = (q0.clientY + q1.clientY) / 2;
						this.palette.show(
							activeDocument.body,
							cx,
							cy,
							this.settings.handedness,
						);
					}, TWO_FINGER_HOLD_MS);
				}
				return;
			}
			// Pen always draws (Apple Pencil), mouse draws for desktop testing.
			if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
			// If the palette is up, a tap on the canvas is the outside-close
			// gesture; don't also start a stroke.
			if (this.palette.isOpen()) return;
			canvas.setPointerCapture(e.pointerId);
			activePointerId = e.pointerId;
			downPoint = { clientX: e.clientX, clientY: e.clientY };

			if (this.toolState.tool === 'eraser') {
				// Defer the first erase to pointermove so a stationary press
				// opens the palette without destroying a stroke first.
				eraserActive = true;
				eraseTouched = false;
				const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
				const pdfPath = key ? filePathFromKey(key) : null;
				if (key && pdfPath) {
					eraseSnapshot = {
						pdfPath,
						key,
						prevStrokes: [...(this.strokes.get(key) ?? [])],
					};
				}
			} else {
				inProgress = [toNormalized(e)];
			}

			cancelLongPress();
			const openX = e.clientX;
			const openY = e.clientY;
			holdIndicator = createHoldIndicator(
				activeDocument,
				openX,
				openY,
				LONG_PRESS_MS,
			);
			activeDocument.body.appendChild(holdIndicator);
			longPressTimer = window.setTimeout(() => {
				longPressTimer = null;
				removeHoldIndicator();
				// Stationary hold: abandon any in-progress stroke, wipe any
				// sub-threshold ink that landed, and pop the palette.
				inProgress = null;
				eraserActive = false;
				eraseSnapshot = null;
				eraseTouched = false;
				this.redrawPage(canvas);
				if (activePointerId !== null) {
					try { canvas.releasePointerCapture(activePointerId); } catch {
						// already released — safe to ignore
					}
					activePointerId = null;
				}
				this.palette.show(activeDocument.body, openX, openY, this.settings.handedness);
			}, LONG_PRESS_MS);
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', (e) => {
			if (e.pointerType === 'touch') {
				const t = activeTouches.get(e.pointerId);
				if (!t) return;
				t.clientX = e.clientX;
				t.clientY = e.clientY;
				if (twoFingerTimer !== null) {
					const dx = e.clientX - t.downX;
					const dy = e.clientY - t.downY;
					if (
						dx * dx + dy * dy >
						TWO_FINGER_MOVE_PX * TWO_FINGER_MOVE_PX
					) {
						cancelTwoFinger();
					}
				}
				return;
			}
			if (longPressTimer !== null && downPoint) {
				const dx = e.clientX - downPoint.clientX;
				const dy = e.clientY - downPoint.clientY;
				if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
					cancelLongPress();
				}
			}
			if (eraserActive) {
				if (this.eraseAt(canvas, e)) eraseTouched = true;
				e.preventDefault();
				return;
			}
			if (!inProgress) return;
			const prev = inProgress[inProgress.length - 1];
			if (!prev) return;
			const p = toNormalized(e);
			inProgress.push(p);
			if (this.toolState.tool === 'highlighter') {
				// Highlighter must avoid the per-segment alpha-overlap beading.
				// Cheapest correct approach: redraw the page and repaint the
				// in-progress points as one continuous polyline each move.
				this.redrawPage(canvas);
				drawHighlighterPolyline(
					ctx,
					inProgress,
					this.toolState.color,
					this.toolState.width,
					canvas.width,
					canvas.height,
				);
			} else {
				drawSegment(
					ctx,
					prev,
					p,
					this.toolState.tool,
					this.toolState.color,
					this.toolState.width,
					canvas.width,
					canvas.height,
				);
			}
			e.preventDefault();
		});

		const finish = (e: PointerEvent) => {
			if (e.pointerType === 'touch') {
				activeTouches.delete(e.pointerId);
				if (activeTouches.size < 2) cancelTwoFinger();
				return;
			}
			cancelLongPress();
			downPoint = null;
			activePointerId = null;
			if (eraserActive) {
				eraserActive = false;
				if (eraseTouched && eraseSnapshot) {
					this.pushUndo(eraseSnapshot);
				}
				eraseSnapshot = null;
				eraseTouched = false;
				try {
					canvas.releasePointerCapture(e.pointerId);
				} catch {
					// already released
				}
				return;
			}
			if (inProgress) {
				const stroke: Stroke = {
					points: inProgress,
					color: this.toolState.color,
					width: this.toolState.width,
					tool: this.toolState.tool,
				};
				const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
				if (key) {
					const existing = this.strokes.get(key) ?? [];
					const pdfPath = filePathFromKey(key);
					if (pdfPath) {
						this.pushUndo({ pdfPath, key, prevStrokes: [...existing] });
					}
					existing.push(stroke);
					this.strokes.set(key, existing);
					if (pdfPath) this.scheduleSave(pdfPath);
				}
				inProgress = null;
				// Replace the rough live-drawn segments with the smoothed
				// replay so the finished stroke matches the saved one. rAF
				// defers past whatever Obsidian does on pointerup — a
				// synchronous redraw here used to wipe the stroke (the
				// regression we fixed in 0.2.1).
				window.requestAnimationFrame(() => this.redrawPage(canvas));
			}
			try {
				canvas.releasePointerCapture(e.pointerId);
			} catch {
				// releasePointerCapture throws if the pointer isn't captured
				// (e.g. pointercancel after losing capture) — safe to ignore.
			}
			// No redraw needed: the live pointermove handler already painted the
			// stroke to the canvas, and the stroke is now in the in-memory map for
			// future redraws (resize, page mutation, file re-open). Reclearing and
			// repainting here used to wipe the stroke on pointerup in Obsidian's
			// PDF view — visible during draw, gone the instant the pointer lifted.
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<JotSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
		// Restore the last-used tool/color/width so the user picks up
		// where they left off instead of getting reset to the default.
		this.toolState = { ...this.settings.toolState };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private eraseAt(canvas: HTMLCanvasElement, e: PointerEvent): boolean {
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return false;
		const strokes = this.strokes.get(key);
		if (!strokes || strokes.length === 0) return false;
		const rect = canvas.getBoundingClientRect();
		const x = (e.clientX - rect.left) / rect.width;
		const y = (e.clientY - rect.top) / rect.height;
		const kept: Stroke[] = [];
		let removed = 0;
		for (const stroke of strokes) {
			if (strokeIntersects(stroke, x, y, ERASE_RADIUS)) {
				removed += 1;
			} else {
				kept.push(stroke);
			}
		}
		if (removed === 0) return false;
		this.strokes.set(key, kept);
		this.redrawPage(canvas);
		const pdfPath = filePathFromKey(key);
		if (pdfPath) this.scheduleSave(pdfPath);
		return true;
	}

	private pushUndo(entry: UndoEntry) {
		const stack = this.undoStacks.get(entry.pdfPath) ?? [];
		stack.push(entry);
		if (stack.length > MAX_UNDO_DEPTH) stack.shift();
		this.undoStacks.set(entry.pdfPath, stack);
		// A fresh edit invalidates any forward history.
		this.redoStacks.delete(entry.pdfPath);
	}

	canUndoActivePdf(): boolean {
		const path = this.getActivePdfFilePath();
		if (!path) return false;
		return (this.undoStacks.get(path)?.length ?? 0) > 0;
	}

	canRedoActivePdf(): boolean {
		const path = this.getActivePdfFilePath();
		if (!path) return false;
		return (this.redoStacks.get(path)?.length ?? 0) > 0;
	}

	undoActivePdf() {
		const path = this.getActivePdfFilePath();
		if (!path) return;
		const stack = this.undoStacks.get(path);
		if (!stack || stack.length === 0) return;
		const entry = stack.pop();
		if (!entry) return;
		this.undoStacks.set(path, stack);
		const current = this.strokes.get(entry.key) ?? [];
		const redoStack = this.redoStacks.get(path) ?? [];
		redoStack.push({ pdfPath: path, key: entry.key, prevStrokes: [...current] });
		this.redoStacks.set(path, redoStack);
		this.strokes.set(entry.key, [...entry.prevStrokes]);
		const canvas = this.overlayForKey(entry.key);
		if (canvas) this.redrawPage(canvas);
		this.scheduleSave(path);
	}

	redoActivePdf() {
		const path = this.getActivePdfFilePath();
		if (!path) return;
		const stack = this.redoStacks.get(path);
		if (!stack || stack.length === 0) return;
		const entry = stack.pop();
		if (!entry) return;
		this.redoStacks.set(path, stack);
		const current = this.strokes.get(entry.key) ?? [];
		const undoStack = this.undoStacks.get(path) ?? [];
		undoStack.push({ pdfPath: path, key: entry.key, prevStrokes: [...current] });
		this.undoStacks.set(path, undoStack);
		this.strokes.set(entry.key, [...entry.prevStrokes]);
		const canvas = this.overlayForKey(entry.key);
		if (canvas) this.redrawPage(canvas);
		this.scheduleSave(path);
	}

	private async startMergeFlow(pdfPath: string) {
		await this.ensureLoaded(pdfPath);
		const hasStrokes = this.pdfHasStrokes(pdfPath);
		if (!hasStrokes) {
			new Notice('Jot: no notes on this PDF to merge.');
			return;
		}
		const copyTarget = await this.uniqueAnnotatedPath(pdfPath);
		new ExportChoiceModal(this.app, copyTarget, (choice) => {
			if (choice === 'cancel') return;
			void this.runMerge(pdfPath, choice, copyTarget);
		}).open();
	}

	private async runMerge(
		pdfPath: string,
		choice: 'overwrite' | 'copy',
		copyTarget: string,
	) {
		try {
			const outPath = await this.doMerge(pdfPath, choice, copyTarget);
			if (choice === 'overwrite') {
				await this.discardSidecar(pdfPath);
			}
			new Notice(`Jot: notes merged into ${outPath}`);
		} catch (err) {
			console.error(`${PLUGIN_LOG} merge failed:`, err);
			new Notice(
				`Jot: merge failed — ${err instanceof Error ? err.message : 'see console'}`,
			);
		}
	}

	private pdfHasStrokes(pdfPath: string): boolean {
		const prefix = pdfPath + '::';
		for (const [key, strokes] of this.strokes.entries()) {
			if (key.startsWith(prefix) && strokes.length > 0) return true;
		}
		return false;
	}

	private async doMerge(
		pdfPath: string,
		choice: 'overwrite' | 'copy',
		copyTarget: string,
	): Promise<string> {
		const bytes = await this.app.vault.adapter.readBinary(pdfPath);
		const pdfDoc = await PDFDocument.load(bytes);
		const pages = pdfDoc.getPages();
		for (let i = 0; i < pages.length; i++) {
			const page = pages[i];
			if (!page) continue;
			const pageNumber = i + 1;
			const strokes = this.strokes.get(pageKey(pdfPath, pageNumber)) ?? [];
			if (strokes.length === 0) continue;
			drawStrokesOnPdfPage(page, strokes);
		}
		const out = await pdfDoc.save();
		const outPath = choice === 'overwrite' ? pdfPath : copyTarget;
		await this.app.vault.adapter.writeBinary(outPath, out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer);
		return outPath;
	}

	private async uniqueAnnotatedPath(pdfPath: string): Promise<string> {
		const base = pdfPath.replace(/\.pdf$/i, '.annotated');
		let candidate = `${base}.pdf`;
		let n = 2;
		while (await this.app.vault.adapter.exists(candidate)) {
			candidate = `${base}.${n}.pdf`;
			n++;
		}
		return candidate;
	}

	private async discardSidecar(pdfPath: string) {
		const path = this.inkPathFor(pdfPath);
		try {
			if (await this.app.vault.adapter.exists(path)) {
				await this.app.vault.adapter.remove(path);
			}
		} catch (err) {
			console.error(`${PLUGIN_LOG} could not delete sidecar ${path}:`, err);
		}
		// Drop in-memory strokes for this PDF and reset its undo history so a
		// fresh editing session starts on top of the now-baked PDF.
		const prefix = pdfPath + '::';
		for (const key of [...this.strokes.keys()]) {
			if (key.startsWith(prefix)) this.strokes.delete(key);
		}
		this.undoStacks.delete(pdfPath);
		this.redoStacks.delete(pdfPath);
		// Redraw any currently-open overlays for this PDF so the user sees
		// the cleared state immediately.
		const leaf = this.getActivePdfLeaf();
		if (leaf) {
			leaf.view.containerEl
				.querySelectorAll<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`)
				.forEach((canvas) => this.redrawPage(canvas));
		}
	}

	private startClearFlow(pdfPath: string) {
		new ConfirmClearModal(this.app, pdfPath, () => {
			this.clearAnnotations(pdfPath);
		}).open();
	}

	private clearAnnotations(pdfPath: string) {
		const prefix = pdfPath + '::';
		let cleared = 0;
		for (const [key, strokes] of this.strokes.entries()) {
			if (!key.startsWith(prefix)) continue;
			if (strokes.length === 0) continue;
			// One undo entry per page so undo restores them one page at a
			// time — the existing UndoEntry shape is single-key, and bulk
			// clear is rare enough not to warrant a new multi-page entry
			// type.
			this.pushUndo({ pdfPath, key, prevStrokes: [...strokes] });
			this.strokes.set(key, []);
			cleared += strokes.length;
		}
		if (cleared === 0) return;
		this.scheduleSave(pdfPath);
		const leaf = this.getActivePdfLeaf();
		if (leaf) {
			leaf.view.containerEl
				.querySelectorAll<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`)
				.forEach((canvas) => this.redrawPage(canvas));
		}
		new Notice(
			`Jot: cleared ${cleared} stroke${cleared === 1 ? '' : 's'}. Undo to restore.`,
		);
	}

	private overlayForKey(key: string): HTMLCanvasElement | null {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return null;
		const escaped = key.replace(/["\\]/g, '\\$&');
		return leaf.view.containerEl.querySelector<HTMLCanvasElement>(
			`canvas.${OVERLAY_CLASS}[${OVERLAY_KEY_ATTR}="${escaped}"]`,
		);
	}
}

interface UndoEntry {
	pdfPath: string;
	key: string;
	prevStrokes: Stroke[];
}

class ConfirmClearModal extends Modal {
	private pdfPath: string;
	private onConfirm: () => void;

	constructor(app: App, pdfPath: string, onConfirm: () => void) {
		super(app);
		this.pdfPath = pdfPath;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		const basename = this.pdfPath.replace(/.*\//, '');
		contentEl.createEl('h2', { text: 'Clear annotations?' });
		contentEl.createEl('p', {
			text: `Removes every stroke on every page of "${basename}". Undo restores them one page at a time.`,
		});
		const buttons = contentEl.createDiv({ cls: 'jot-modal-buttons' });
		const clearBtn = buttons.createEl('button', { text: 'Clear' });
		clearBtn.classList.add('mod-warning');
		clearBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

function createHoldIndicator(
	doc: Document,
	clientX: number,
	clientY: number,
	durationMs: number,
): HTMLElement {
	const el = doc.createElement('div');
	el.className = 'jot-hold-indicator';
	el.style.left = `${clientX}px`;
	el.style.top = `${clientY}px`;
	el.style.setProperty('--jot-hold-duration', `${durationMs}ms`);
	const ns = 'http://www.w3.org/2000/svg';
	const svg = doc.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 28 28');
	const circle = doc.createElementNS(ns, 'circle');
	circle.setAttribute('cx', '14');
	circle.setAttribute('cy', '14');
	circle.setAttribute('r', '12');
	svg.appendChild(circle);
	el.appendChild(svg);
	return el;
}

