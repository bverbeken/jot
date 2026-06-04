import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
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
import { ConfirmClearModal } from './clear';
import { collectClearOperations, countStrokes, toUndoEntries } from './clear-ops';
import { createHoldIndicator } from './hold-indicator';
import { LongPressDetector } from './long-press';
import { TwoFingerHoldDetector } from './two-finger-hold';
import { isSidecarPath, pageKey, pdfPathFromKey, pdfPathFromSidecar } from './jot-file';
import { SidecarStore } from './sidecar-store';
import { StrokeStore } from './stroke-store';
import { UndoEntry, UndoHistory } from './undo';

export type { Handedness } from './palette';

const PLUGIN_LOG = '[jot]';
const OVERLAY_CLASS = 'jot-overlay';
const PAGE_ANCHOR_CLASS = 'jot-page-anchor';
const PASSTHROUGH_CLASS = 'jot-passthrough';
const OVERLAY_KEY_ATTR = 'data-jot-key';
const PAGE_OBSERVED_ATTR = 'data-jot-observed';
const LONG_PRESS_MS = 300;
const LONG_PRESS_MOVE_PX = 15;
const TWO_FINGER_HOLD_MS = 300;
const TWO_FINGER_MOVE_PX = 25;

export default class JotPlugin extends Plugin {
	private containerObservers = new Map<WorkspaceLeaf, MutationObserver>();
	private strokes = new StrokeStore();
	private sidecar!: SidecarStore;
	private toolState: ToolState = { ...DEFAULT_TOOL_STATE };
	private palette!: Palette;
	settings: JotSettings = { ...DEFAULT_SETTINGS };
	private history = new UndoHistory();

	async onload() {
		await this.loadSettings();
		this.sidecar = new SidecarStore(this.app.vault.adapter, this.strokes);
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
				const mem = this.palette.getMemory();
				this.settings.penState = mem.pen;
				this.settings.highlighterState = mem.highlighter;
				void this.saveSettings();
			},
			{
				onUndo: () => this.undoActivePdf(),
				onRedo: () => this.redoActivePdf(),
				canUndo: () => this.canUndoActivePdf(),
				canRedo: () => this.canRedoActivePdf(),
			},
			{
				pen: this.settings.penState,
				highlighter: this.settings.highlighterState,
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

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!isSidecarPath(file.path)) return;
				if (this.sidecar.isOwnRecentSave(file.path)) return;
				const pdfPath = pdfPathFromSidecar(file.path);
				if (pdfPath) void this.reloadSidecar(pdfPath);
			}),
		);

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
		this.sidecar?.cancelAllPending();
		this.palette?.hide();
	}

	private async ensureLoaded(pdfPath: string) {
		await this.sidecar.load(pdfPath);
	}

	private async reloadSidecar(pdfPath: string) {
		await this.sidecar.load(pdfPath);
		this.app.workspace.iterateAllLeaves((leaf) => {
			const file = (leaf.view as { file?: TFile }).file;
			if (file?.path !== pdfPath) return;
			leaf.view.containerEl
				.querySelectorAll<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`)
				.forEach((canvas) => this.redrawPage(canvas));
		});
	}

	private scheduleSave(pdfPath: string): void {
		this.sidecar.scheduleSave(pdfPath);
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
			existing.remove();
		}

		page.classList.add(PAGE_ANCHOR_CLASS);
		const overlay = activeDocument.createElement('canvas');
		overlay.className = OVERLAY_CLASS;
		overlay.setAttribute(OVERLAY_KEY_ATTR, key);
		this.sizeOverlayToPage(overlay, page);
		page.appendChild(overlay);
		this.disableTextLayerInteraction(page);
		this.wirePointerEvents(overlay);
		this.redrawPage(overlay);

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
		for (const stroke of this.strokes.forKey(key)) {
			drawStroke(ctx, stroke, { width: canvas.width, height: canvas.height });
		}
	}

	private wirePointerEvents(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			console.error(`${PLUGIN_LOG} no 2d context`);
			return;
		}
		this.blockStylusGesturePreemption(canvas);

		const state = new PenStrokeState();
		let activePointerId: number | null = null;
		let holdIndicator: HTMLElement | null = null;
		let twoFingerIndicator: HTMLElement | null = null;

		const removeHoldIndicator = () => {
			holdIndicator?.remove();
			holdIndicator = null;
		};
		const removeTwoFingerIndicator = () => {
			twoFingerIndicator?.remove();
			twoFingerIndicator = null;
		};
		const releasePointerCapture = () => {
			if (activePointerId === null) return;
			try { canvas.releasePointerCapture(activePointerId); } catch {
				/* already released */
			}
			activePointerId = null;
		};

		const openPaletteAt = (x: number, y: number) => {
			this.palette.show(activeDocument.body, x, y, this.settings.handedness);
		};

		const longPress = new LongPressDetector(
			{ durationMs: LONG_PRESS_MS, movementThresholdPx: LONG_PRESS_MOVE_PX },
			{
				onFire: () => {
					removeHoldIndicator();
					const { clientX, clientY } = state.pressedAt;
					state.reset();
					this.redrawPage(canvas);
					releasePointerCapture();
					openPaletteAt(clientX, clientY);
				},
				onCancel: removeHoldIndicator,
			},
		);

		const twoFingerHold = new TwoFingerHoldDetector(
			{ durationMs: TWO_FINGER_HOLD_MS, movementThresholdPx: TWO_FINGER_MOVE_PX },
			{
				onArm: (cx, cy) => {
					if (this.palette.isOpen() || state.isBusy()) {
						twoFingerHold.cancel();
						return;
					}
					twoFingerIndicator = createHoldIndicator(activeDocument, cx, cy, TWO_FINGER_HOLD_MS);
					activeDocument.body.appendChild(twoFingerIndicator);
				},
				onFire: (cx, cy) => {
					if (this.palette.isOpen()) return;
					openPaletteAt(cx, cy);
				},
				onDisarm: removeTwoFingerIndicator,
			},
		);

		canvas.addEventListener('pointerdown', (e) => {
			if (e.pointerType === 'touch') {
				twoFingerHold.pointerDown(e.pointerId, e.clientX, e.clientY);
				return;
			}
			if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
			if (this.palette.isOpen()) return;

			canvas.setPointerCapture(e.pointerId);
			activePointerId = e.pointerId;
			state.beginAt(e, this.toolState.tool, () =>
				this.snapshotForCanvas(canvas),
			);
			if (state.isDrawing()) state.appendDrawingPoint(toNormalized(canvas, e));

			holdIndicator = createHoldIndicator(activeDocument, e.clientX, e.clientY, LONG_PRESS_MS);
			activeDocument.body.appendChild(holdIndicator);
			longPress.start(e.clientX, e.clientY);
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', (e) => {
			if (e.pointerType === 'touch') {
				twoFingerHold.pointerMove(e.pointerId, e.clientX, e.clientY);
				return;
			}
			longPress.move(e.clientX, e.clientY);
			if (state.isErasing()) {
				if (this.eraseAt(canvas, e)) state.markErased();
				e.preventDefault();
				return;
			}
			this.continueDrawingStroke(ctx, canvas, state, e);
		});

		const finish = (e: PointerEvent) => {
			if (e.pointerType === 'touch') {
				twoFingerHold.pointerUp(e.pointerId);
				return;
			}
			longPress.cancel();
			if (state.isErasing()) {
				this.finalizeEraserGesture(state);
				releasePointerCapture();
				return;
			}
			if (state.isDrawing()) {
				this.finalizeDrawingStroke(canvas, state);
				window.requestAnimationFrame(() => this.redrawPage(canvas));
			}
			releasePointerCapture();
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
	}

	private blockStylusGesturePreemption(canvas: HTMLCanvasElement) {
		const blockStylus = (e: TouchEvent) => {
			for (let i = 0; i < e.touches.length; i++) {
				const t = e.touches.item(i) as Touch & { touchType?: string };
				if (t?.touchType === 'stylus') {
					e.preventDefault();
					return;
				}
			}
		};
		canvas.addEventListener('touchstart', blockStylus, { passive: false });
		canvas.addEventListener('touchmove', blockStylus, { passive: false });
	}

	private snapshotForCanvas(canvas: HTMLCanvasElement): UndoEntry | null {
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return null;
		const pdfPath = pdfPathFromKey(key);
		if (!pdfPath) return null;
		return { pdfPath, key, prevStrokes: [...(this.strokes.forKey(key))] };
	}

	private continueDrawingStroke(
		ctx: CanvasRenderingContext2D,
		canvas: HTMLCanvasElement,
		state: PenStrokeState,
		e: PointerEvent,
	) {
		if (!state.isDrawing()) return;
		const previous = state.lastDrawingPoint();
		if (!previous) return;
		const next = toNormalized(canvas, e);
		state.appendDrawingPoint(next);
		const canvasSize = { width: canvas.width, height: canvas.height };
		if (this.toolState.tool === 'highlighter') {
			this.redrawPage(canvas);
			drawHighlighterPolyline(
				ctx,
				state.drawingPoints(),
				this.toolState.color,
				this.toolState.width,
				canvasSize,
			);
		} else {
			drawSegment(
				ctx,
				previous,
				next,
				this.toolState.color,
				this.toolState.width,
				canvasSize,
			);
		}
		e.preventDefault();
	}

	private finalizeEraserGesture(state: PenStrokeState) {
		const snapshot = state.takeEraserSnapshot();
		if (snapshot) this.pushUndo(snapshot);
		state.reset();
	}

	private finalizeDrawingStroke(canvas: HTMLCanvasElement, state: PenStrokeState) {
		const points = state.drawingPoints();
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (key && points.length > 0) {
			const pdfPath = pdfPathFromKey(key);
			if (pdfPath) {
				this.pushUndo({ pdfPath, key, prevStrokes: [...this.strokes.forKey(key)] });
			}
			this.strokes.appendToKey(key, {
				points,
				color: this.toolState.color,
				width: this.toolState.width,
				tool: this.toolState.tool,
			});
			if (pdfPath) this.scheduleSave(pdfPath);
		}
		state.reset();
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<JotSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
		this.toolState = { ...this.settings.toolState };
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private eraseAt(canvas: HTMLCanvasElement, e: PointerEvent): boolean {
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return false;
		const strokes = this.strokes.forKey(key);
		if (strokes.length === 0) return false;
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
		this.strokes.setForKey(key, kept);
		this.redrawPage(canvas);
		const pdfPath = pdfPathFromKey(key);
		if (pdfPath) this.scheduleSave(pdfPath);
		return true;
	}

	private pushUndo(entry: UndoEntry) {
		this.history.push(entry);
	}

	canUndoActivePdf(): boolean {
		const path = this.getActivePdfFilePath();
		return path !== null && this.history.canUndo(path);
	}

	canRedoActivePdf(): boolean {
		const path = this.getActivePdfFilePath();
		return path !== null && this.history.canRedo(path);
	}

	undoActivePdf() {
		const path = this.getActivePdfFilePath();
		if (!path) return;
		const entry = this.history.popUndo(path, (key) => this.strokes.forKey(key));
		if (entry) this.applyHistoryEntry(path, entry);
	}

	redoActivePdf() {
		const path = this.getActivePdfFilePath();
		if (!path) return;
		const entry = this.history.popRedo(path, (key) => this.strokes.forKey(key));
		if (entry) this.applyHistoryEntry(path, entry);
	}

	private applyHistoryEntry(pdfPath: string, entry: UndoEntry) {
		this.strokes.setForKey(entry.key, [...entry.prevStrokes]);
		const canvas = this.overlayForKey(entry.key);
		if (canvas) this.redrawPage(canvas);
		this.scheduleSave(pdfPath);
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
		return this.strokes.hasFor(pdfPath);
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
			const strokes = this.strokes.forPage(pdfPath, pageNumber);
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
		await this.sidecar.discard(pdfPath);
		this.strokes.clearFor(pdfPath);
		this.history.dropPath(pdfPath);
		this.redrawOverlaysForActivePdf();
	}

	private redrawOverlaysForActivePdf() {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return;
		leaf.view.containerEl
			.querySelectorAll<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`)
			.forEach((canvas) => this.redrawPage(canvas));
	}

	private startClearFlow(pdfPath: string) {
		new ConfirmClearModal(this.app, pdfPath, () => this.applyClear(pdfPath)).open();
	}

	private applyClear(pdfPath: string) {
		const operations = collectClearOperations(pdfPath, this.strokes.asMap());
		const totalStrokes = countStrokes(operations);
		if (totalStrokes === 0) return;
		for (const entry of toUndoEntries(pdfPath, operations)) {
			this.pushUndo(entry);
			this.strokes.clearKey(entry.key);
		}
		this.scheduleSave(pdfPath);
		this.redrawOverlaysForActivePdf();
		new Notice(
			`Jot: cleared ${totalStrokes} stroke${totalStrokes === 1 ? '' : 's'}. Undo to restore.`,
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

function toNormalized(canvas: HTMLCanvasElement, e: PointerEvent): NormalizedPoint {
	const rect = canvas.getBoundingClientRect();
	return {
		x: (e.clientX - rect.left) / rect.width,
		y: (e.clientY - rect.top) / rect.height,
		pressure: e.pressure,
	};
}

class PenStrokeState {
	private drawing: NormalizedPoint[] | null = null;
	private eraserActive = false;
	private eraserSnapshot: UndoEntry | null = null;
	private eraserTouched = false;
	pressedAt = { clientX: 0, clientY: 0 };

	beginAt(e: PointerEvent, tool: 'pen' | 'highlighter' | 'eraser', snapshotForEraser: () => UndoEntry | null): void {
		this.pressedAt = { clientX: e.clientX, clientY: e.clientY };
		if (tool === 'eraser') {
			this.eraserActive = true;
			this.eraserTouched = false;
			this.eraserSnapshot = snapshotForEraser();
		} else {
			this.drawing = [];
		}
	}

	isDrawing(): boolean {
		return this.drawing !== null;
	}

	isErasing(): boolean {
		return this.eraserActive;
	}

	isBusy(): boolean {
		return this.isDrawing() || this.isErasing();
	}

	appendDrawingPoint(point: NormalizedPoint): void {
		this.drawing?.push(point);
	}

	drawingPoints(): NormalizedPoint[] {
		return this.drawing ?? [];
	}

	lastDrawingPoint(): NormalizedPoint | null {
		const list = this.drawing;
		if (!list || list.length === 0) return null;
		return list[list.length - 1] ?? null;
	}

	markErased(): void {
		this.eraserTouched = true;
	}

	takeEraserSnapshot(): UndoEntry | null {
		const snapshot = this.eraserTouched ? this.eraserSnapshot : null;
		this.eraserSnapshot = null;
		this.eraserTouched = false;
		this.eraserActive = false;
		return snapshot;
	}

	reset(): void {
		this.drawing = null;
		this.eraserActive = false;
		this.eraserSnapshot = null;
		this.eraserTouched = false;
	}
}

