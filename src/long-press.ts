export interface LongPressOptions {
	durationMs: number;
	movementThresholdPx: number;
}

export class LongPressDetector {
	private downX = 0;
	private downY = 0;
	private timerId: number | null = null;

	constructor(
		private options: LongPressOptions,
		private onFire: () => void,
	) {}

	start(x: number, y: number): void {
		this.cancel();
		this.downX = x;
		this.downY = y;
		this.timerId = window.setTimeout(() => {
			this.timerId = null;
			this.onFire();
		}, this.options.durationMs);
	}

	move(x: number, y: number): void {
		if (this.timerId === null) return;
		const dx = x - this.downX;
		const dy = y - this.downY;
		const thresholdSquared = this.options.movementThresholdPx ** 2;
		if (dx * dx + dy * dy > thresholdSquared) this.cancel();
	}

	cancel(): void {
		if (this.timerId === null) return;
		window.clearTimeout(this.timerId);
		this.timerId = null;
	}

	isActive(): boolean {
		return this.timerId !== null;
	}
}
