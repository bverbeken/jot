type MaybeStylusTouch = { touchType?: string };

/**
 * Decides whether a touch event belongs to a stylus, so the browser can be
 * stopped from turning a pen stroke into a scroll. iPadOS tags stylus touches
 * with the non-standard `touchType`; Chromium on Android does not, so we also
 * remember pen pointers, whose pointerdown arrives before the touchstart.
 */
export class StylusGestureGuard {
	private activePens = new Set<number>();

	penDown(pointerId: number): void {
		this.activePens.add(pointerId);
	}

	penUp(pointerId: number): void {
		this.activePens.delete(pointerId);
	}

	/** Called when the last touch lifts, in case a pen's pointerup never reached us. */
	reset(): void {
		this.activePens.clear();
	}

	shouldBlock(touches: ArrayLike<MaybeStylusTouch | null>): boolean {
		if (this.activePens.size > 0) return true;
		for (let i = 0; i < touches.length; i++) {
			if (touches[i]?.touchType === 'stylus') return true;
		}
		return false;
	}
}
