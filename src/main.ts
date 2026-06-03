import { Plugin, TFile, WorkspaceLeaf } from 'obsidian';

const PLUGIN_LOG = '[jot]';
const OVERLAY_CLASS = 'jot-overlay';
const PAGE_ANCHOR_CLASS = 'jot-page-anchor';
const PASSTHROUGH_CLASS = 'jot-passthrough';
const OVERLAY_KEY_ATTR = 'data-jot-key';
const PAGE_OBSERVED_ATTR = 'data-jot-observed';
const STROKE_COLOR = '#d33';
// Stroke width as a fraction of the page's rendered height — keeps lines
// looking the same thickness relative to the PDF at any zoom level.
const STROKE_WIDTH = 0.0025;
// Pressure (0..1) scales the per-segment width by this factor range. The
// floor keeps a barely-touching stroke visible; the ceiling gives a clear
// heavy-press marker. Mouse input reports pressure 0.5 (button down), which
// lands near the middle of the range, so desktop testing looks normal.
const PRESSURE_MIN_FACTOR = 0.5;
const PRESSURE_MAX_FACTOR = 1.8;
const INK_SUFFIX = '.ink.json';
const SAVE_DEBOUNCE_MS = 250;
const INK_FORMAT_VERSION = 1;

interface InkFileFormat {
	version: number;
	pages: Record<string, Stroke[]>;
}

interface NormalizedPoint {
	x: number;
	y: number;
	pressure: number;
}

interface Stroke {
	points: NormalizedPoint[];
	color: string;
	width: number;
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
	private loaded = new Set<string>();
	private saveTimers = new Map<string, number>();

	async onload() {
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
	}

	private inkPathFor(pdfPath: string): string {
		return pdfPath + INK_SUFFIX;
	}

	private async ensureLoaded(pdfPath: string) {
		if (this.loaded.has(pdfPath)) return;
		this.loaded.add(pdfPath);
		await this.loadFromDisk(pdfPath);
	}

	private async loadFromDisk(pdfPath: string) {
		const path = this.inkPathFor(pdfPath);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return;
			const text = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(text) as InkFileFormat;
			if (parsed.version !== INK_FORMAT_VERSION) {
				console.warn(
					`${PLUGIN_LOG} ${path} has unknown version ${parsed.version}, skipping`,
				);
				return;
			}
			for (const [pageNumStr, strokes] of Object.entries(parsed.pages)) {
				const pageNumber = parseInt(pageNumStr, 10);
				if (Number.isNaN(pageNumber)) continue;
				this.strokes.set(pageKey(pdfPath, pageNumber), strokes);
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
		} catch (err) {
			console.error(`${PLUGIN_LOG} saveToDisk failed for ${path}:`, err);
		}
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

		const toNormalized = (e: PointerEvent): NormalizedPoint => {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (e.clientX - rect.left) / rect.width,
				y: (e.clientY - rect.top) / rect.height,
				pressure: e.pressure,
			};
		};

		canvas.addEventListener('pointerdown', (e) => {
			// Pen always draws (Apple Pencil), mouse draws for desktop testing.
			// Finger touch is ignored so it can scroll the PDF view underneath.
			if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
			canvas.setPointerCapture(e.pointerId);
			inProgress = [toNormalized(e)];
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', (e) => {
			if (!inProgress) return;
			const prev = inProgress[inProgress.length - 1];
			if (!prev) return;
			const p = toNormalized(e);
			inProgress.push(p);
			drawSegment(ctx, prev, p, STROKE_COLOR, STROKE_WIDTH, canvas.width, canvas.height);
			e.preventDefault();
		});

		const finish = (e: PointerEvent) => {
			if (!inProgress) return;
			const stroke: Stroke = {
				points: inProgress,
				color: STROKE_COLOR,
				width: STROKE_WIDTH,
			};
			const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
			if (key) {
				const existing = this.strokes.get(key) ?? [];
				existing.push(stroke);
				this.strokes.set(key, existing);
				const pdfPath = filePathFromKey(key);
				if (pdfPath) this.scheduleSave(pdfPath);
			}
			inProgress = null;
			try {
				canvas.releasePointerCapture(e.pointerId);
			} catch {
				// releasePointerCapture throws if the pointer isn't captured
				// (e.g. pointercancel after losing capture) — safe to ignore.
			}
			this.redrawPage(canvas);
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
	}
}

function widthFactorForPressure(pressure: number): number {
	const p = Math.max(0, Math.min(1, pressure));
	return PRESSURE_MIN_FACTOR + (PRESSURE_MAX_FACTOR - PRESSURE_MIN_FACTOR) * p;
}

function drawSegment(
	ctx: CanvasRenderingContext2D,
	a: NormalizedPoint,
	b: NormalizedPoint,
	color: string,
	baseWidth: number,
	canvasWidth: number,
	canvasHeight: number,
) {
	const avgPressure = (a.pressure + b.pressure) / 2;
	ctx.lineWidth = baseWidth * widthFactorForPressure(avgPressure) * canvasHeight;
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(a.x * canvasWidth, a.y * canvasHeight);
	ctx.lineTo(b.x * canvasWidth, b.y * canvasHeight);
	ctx.stroke();
}

function drawStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	width: number,
	height: number,
) {
	let prev: NormalizedPoint | null = null;
	for (const p of stroke.points) {
		if (prev) {
			drawSegment(ctx, prev, p, stroke.color, stroke.width, width, height);
		}
		prev = p;
	}
}
