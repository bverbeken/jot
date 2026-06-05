import type { NormalizedPoint } from './stroke-math';
import type { Tool } from './palette';
import type { UndoEntry } from './undo';

export class PenStrokeState {
	private drawing: NormalizedPoint[] | null = null;
	private eraserActive = false;
	private eraserSnapshot: UndoEntry | null = null;
	private eraserTouched = false;
	pressedAt = { clientX: 0, clientY: 0 };

	beginAt(e: PointerEvent, tool: Tool, snapshotForEraser: () => UndoEntry | null): void {
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
