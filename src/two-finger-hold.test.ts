import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TwoFingerHoldDetector } from './two-finger-hold';

const DURATION = 300;
const THRESHOLD = 25;

interface Captured {
	arms: Array<[number, number]>;
	fires: Array<[number, number]>;
	disarms: number;
}

const makeDetector = (): { detector: TwoFingerHoldDetector; captured: Captured } => {
	const captured: Captured = { arms: [], fires: [], disarms: 0 };
	const detector = new TwoFingerHoldDetector(
		{ durationMs: DURATION, movementThresholdPx: THRESHOLD },
		{
			onArm: (x, y) => captured.arms.push([x, y]),
			onFire: (x, y) => captured.fires.push([x, y]),
			onDisarm: () => {
				captured.disarms++;
			},
		},
	);
	return { detector, captured };
};

describe('TwoFingerHoldDetector', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('stays idle on a single finger', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		expect(captured.arms).toHaveLength(0);
		expect(detector.isActive()).toBe(false);
	});

	it('arms on the second finger and reports the midpoint of the two contacts', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		expect(captured.arms).toEqual([[150, 150]]);
	});

	it('fires the centroid after the duration when both fingers stay still', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		vi.advanceTimersByTime(DURATION);
		expect(captured.fires).toEqual([[150, 150]]);
	});

	it('disarms and skips the fire when a finger lifts before the duration', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		detector.pointerUp(1);
		expect(captured.disarms).toBe(1);
		vi.advanceTimersByTime(DURATION);
		expect(captured.fires).toHaveLength(0);
	});

	it('disarms when a finger moves past the threshold', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		detector.pointerMove(1, 100 + THRESHOLD + 1, 100);
		vi.advanceTimersByTime(DURATION);
		expect(captured.disarms).toBe(1);
		expect(captured.fires).toHaveLength(0);
	});

	it('keeps the timer running for sub-threshold movement and reports updated centroid on fire', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		detector.pointerMove(1, 110, 110);
		vi.advanceTimersByTime(DURATION);
		expect(captured.fires[0]).toEqual([155, 155]);
	});

	it('disarms when a third finger lands', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		detector.pointerDown(3, 300, 300);
		expect(captured.disarms).toBe(1);
		vi.advanceTimersByTime(DURATION);
		expect(captured.fires).toHaveLength(0);
	});

	it('ignores moves for unknown pointer ids', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 100, 100);
		detector.pointerDown(2, 200, 200);
		detector.pointerMove(99, 9999, 9999);
		vi.advanceTimersByTime(DURATION);
		expect(captured.fires).toHaveLength(1);
	});

	it('can re-arm after a full release and re-press', () => {
		const { detector, captured } = makeDetector();
		detector.pointerDown(1, 0, 0);
		detector.pointerDown(2, 100, 100);
		detector.pointerUp(1);
		detector.pointerUp(2);
		detector.pointerDown(3, 50, 50);
		detector.pointerDown(4, 150, 150);
		expect(captured.arms).toHaveLength(2);
	});
});
