export interface DragHandlerOptions {
	ignoreMouseInsideSelector?: string;
}

export class DragHandler {
	private dragging = false;
	private activePointerId: number | null = null;
	private startClientX = 0;
	private startClientY = 0;
	private startLeft = 0;
	private startTop = 0;

	constructor(
		private element: HTMLElement,
		private options: DragHandlerOptions = {},
	) {}

	attach(): void {
		this.element.addEventListener('pointerdown', (e) => this.onPointerDown(e), true);
		this.element.addEventListener('pointermove', (e) => this.onPointerMove(e), true);
		this.element.addEventListener('pointerup', (e) => this.onPointerUp(e), true);
		this.element.addEventListener('pointercancel', (e) => this.onPointerUp(e), true);
	}

	private onPointerDown(e: PointerEvent): void {
		if (e.pointerType === 'pen') return;
		if (e.pointerType === 'mouse' && this.startedOnIgnoredChild(e)) return;
		this.dragging = true;
		this.activePointerId = e.pointerId;
		this.startClientX = e.clientX;
		this.startClientY = e.clientY;
		this.startLeft = parseFloat(this.element.style.left) || 0;
		this.startTop = parseFloat(this.element.style.top) || 0;
		this.element.setPointerCapture(e.pointerId);
		e.preventDefault();
		e.stopPropagation();
	}

	private onPointerMove(e: PointerEvent): void {
		if (!this.dragging || e.pointerId !== this.activePointerId) return;
		const dx = e.clientX - this.startClientX;
		const dy = e.clientY - this.startClientY;
		this.element.style.left = `${this.startLeft + dx}px`;
		this.element.style.top = `${this.startTop + dy}px`;
		e.preventDefault();
	}

	private onPointerUp(e: PointerEvent): void {
		if (!this.dragging || e.pointerId !== this.activePointerId) return;
		this.dragging = false;
		this.activePointerId = null;
		try {
			this.element.releasePointerCapture(e.pointerId);
		} catch {
			/* already released */
		}
	}

	private startedOnIgnoredChild(e: PointerEvent): boolean {
		const selector = this.options.ignoreMouseInsideSelector;
		if (!selector) return false;
		const target = e.target as Element | null;
		return target?.closest(selector) !== null && target?.closest(selector) !== undefined;
	}
}
