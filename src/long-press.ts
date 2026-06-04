export interface LongPressOptions {
	durationMs: number;
	movementThresholdPx: number;
}

export interface LongPressCallbacks {
	onFire: () => void;
	onCancel?: () => void;
}

export class LongPressDetector {
	private downX = 0;
	private downY = 0;
	private timerId: number | null = null;

	constructor(
		private options: LongPressOptions,
		private callbacks: LongPressCallbacks,
	) {}

	start(x: number, y: number): void {
		this.cancel();
		this.downX = x;
		this.downY = y;
		this.timerId = window.setTimeout(() => {
			this.timerId = null;
			this.callbacks.onFire();
		}, this.options.durationMs);
	}

	move(x: number, y: number): void {
		if (this.timerId === null) return;
		const dx = x - this.downX;
		const dy = y - this.downY;
		if (dx * dx + dy * dy > this.options.movementThresholdPx ** 2) this.cancel();
	}

	cancel(): void {
		if (this.timerId === null) return;
		window.clearTimeout(this.timerId);
		this.timerId = null;
		this.callbacks.onCancel?.();
	}

	isActive(): boolean {
		return this.timerId !== null;
	}
}
