import { Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_TOOL_STATE, Palette, ToolState } from './palette';
import { DEFAULT_SETTINGS, JotSettings, JotSettingTab } from './settings';
import {
	drawHighlighterPolyline,
	drawSegment,
	ERASE_RADIUS,
	NormalizedPoint,
	Stroke,
	strokeIntersects,
} from './strokes';
import { ConfirmClearModal } from './clear';
import { collectClearOperations, countStrokes, toUndoEntries } from './clear-ops';
import { createHoldIndicator } from './hold-indicator';
import { LongPressDetector } from './long-press';
import { TwoFingerHoldDetector } from './two-finger-hold';
import { PenStrokeState } from './pen-stroke-state';
import { isSidecarPath, pdfPathFromKey, pdfPathFromSidecar } from './jot-file';
import { MergeService } from './merge-service';
import { OVERLAY_KEY_ATTR, OverlayManager } from './overlay-manager';
import { SidecarStore } from './sidecar-store';
import { StrokeStore } from './stroke-store';
import { UndoController } from './undo-controller';
import { UndoEntry, UndoHistory } from './undo';

export type { Handedness } from './palette';

const PLUGIN_LOG = '[jot]';
const LONG_PRESS_MS = 300;
const LONG_PRESS_MOVE_PX = 15;
const TWO_FINGER_HOLD_MS = 300;
const TWO_FINGER_MOVE_PX = 25;

export default class JotPlugin extends Plugin {
	private strokes = new StrokeStore();
	private sidecar!: SidecarStore;
	private merge!: MergeService;
	private overlays!: OverlayManager;
	private toolState: ToolState = { ...DEFAULT_TOOL_STATE };
	private palette!: Palette;
	settings: JotSettings = { ...DEFAULT_SETTINGS };
	private history = new UndoHistory();
	private undoController!: UndoController;

	async onload() {
		await this.loadSettings();
		this.sidecar = new SidecarStore(this.app.vault.adapter, this.strokes);
		this.overlays = new OverlayManager(this.app, this.strokes, (canvas) =>
			this.wirePointerEvents(canvas),
		);
		this.undoController = new UndoController(this.history, this.strokes, this.overlays, {
			activePdfPath: () => this.overlays.getActivePdfFilePath(),
			onAfterApply: (pdfPath) => this.scheduleSave(pdfPath),
		});
		this.merge = new MergeService(
			this.app,
			this.app.vault.adapter,
			this.strokes,
			this.sidecar,
			this.history,
			{
				ensureLoaded: (pdfPath) => this.ensureLoaded(pdfPath),
				redrawOverlays: () => this.overlays.redrawOverlaysForActivePdf(),
			},
		);
		this.addSettingTab(new JotSettingTab(this.app, this));
		this.addCommand({
			id: 'merge-notes-into-pdf',
			name: 'Merge notes into PDF',
			checkCallback: (checking) => {
				const path = this.overlays.getActivePdfFilePath();
				if (!path) return false;
				if (!checking) void this.merge.start(path);
				return true;
			},
		});
		this.addCommand({
			id: 'clear-annotations',
			name: 'Clear annotations on this PDF',
			checkCallback: (checking) => {
				const path = this.overlays.getActivePdfFilePath();
				if (!path) return false;
				if (!this.strokes.hasFor(path)) return false;
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
				onUndo: () => this.undoController.undo(),
				onRedo: () => this.undoController.redo(),
				canUndo: () => this.undoController.canUndo(),
				canRedo: () => this.undoController.canRedo(),
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
				window.setTimeout(() => this.overlays.attachToActivePdf(), 300);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.overlays.pruneClosedObservers();
				this.overlays.attachToActivePdf();
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
			const filePath = this.overlays.getActivePdfFilePath();
			if (!filePath) return;
			await this.ensureLoaded(filePath);
			this.overlays.attachToActivePdf();
		});
	}

	onunload() {
		this.overlays?.disconnectAll();
		this.sidecar?.cancelAllPending();
		this.palette?.hide();
	}

	private async ensureLoaded(pdfPath: string) {
		await this.sidecar.load(pdfPath);
	}

	private async reloadSidecar(pdfPath: string) {
		await this.sidecar.load(pdfPath);
		this.overlays.redrawOverlaysForPdf(pdfPath);
	}

	private scheduleSave(pdfPath: string): void {
		this.sidecar.scheduleSave(pdfPath);
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
					this.overlays.redrawPage(canvas);
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
				window.requestAnimationFrame(() => this.overlays.redrawPage(canvas));
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
			this.overlays.redrawPage(canvas);
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
		this.overlays.redrawPage(canvas);
		const pdfPath = pdfPathFromKey(key);
		if (pdfPath) this.scheduleSave(pdfPath);
		return true;
	}

	private pushUndo(entry: UndoEntry) {
		this.undoController.push(entry);
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
		this.overlays.redrawOverlaysForActivePdf();
		new Notice(
			`Jot: cleared ${totalStrokes} stroke${totalStrokes === 1 ? '' : 's'}. Undo to restore.`,
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


