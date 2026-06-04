export interface TwoFingerHoldOptions {
	durationMs: number;
	movementThresholdPx: number;
}

export interface TwoFingerHoldCallbacks {
	onArm: (centroidX: number, centroidY: number) => void;
	onFire: (centroidX: number, centroidY: number) => void;
	onDisarm: () => void;
}

interface TrackedTouch {
	x: number;
	y: number;
	downX: number;
	downY: number;
}

const REQUIRED_TOUCH_COUNT = 2;

export class TwoFingerHoldDetector {
	private touches = new Map<number, TrackedTouch>();
	private timerId: number | null = null;

	constructor(
		private options: TwoFingerHoldOptions,
		private callbacks: TwoFingerHoldCallbacks,
	) {}

	pointerDown(id: number, x: number, y: number): void {
		this.touches.set(id, { x, y, downX: x, downY: y });
		this.cancel();
		if (this.touches.size === REQUIRED_TOUCH_COUNT) this.arm();
	}

	pointerMove(id: number, x: number, y: number): void {
		const touch = this.touches.get(id);
		if (!touch) return;
		touch.x = x;
		touch.y = y;
		if (this.timerId === null) return;
		const dx = x - touch.downX;
		const dy = y - touch.downY;
		if (dx * dx + dy * dy > this.options.movementThresholdPx ** 2) this.cancel();
	}

	pointerUp(id: number): void {
		this.touches.delete(id);
		if (this.touches.size < REQUIRED_TOUCH_COUNT) this.cancel();
	}

	cancel(): void {
		if (this.timerId === null) return;
		window.clearTimeout(this.timerId);
		this.timerId = null;
		this.callbacks.onDisarm();
	}

	isActive(): boolean {
		return this.timerId !== null;
	}

	private arm(): void {
		this.timerId = window.setTimeout(() => {
			this.timerId = null;
			if (this.touches.size !== REQUIRED_TOUCH_COUNT) return;
			const fireCenter = this.centroid();
			this.callbacks.onFire(fireCenter.x, fireCenter.y);
		}, this.options.durationMs);
		const center = this.centroid();
		this.callbacks.onArm(center.x, center.y);
	}

	private centroid(): { x: number; y: number } {
		let sumX = 0;
		let sumY = 0;
		for (const touch of this.touches.values()) {
			sumX += touch.x;
			sumY += touch.y;
		}
		const count = this.touches.size;
		return { x: sumX / count, y: sumY / count };
	}
}
