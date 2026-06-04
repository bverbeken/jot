import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LongPressDetector } from '../src/long-press';

const DURATION = 300;
const THRESHOLD = 5;

const makeDetector = (
	onFire: () => void = () => {},
	onCancel: () => void = () => {},
) =>
	new LongPressDetector(
		{ durationMs: DURATION, movementThresholdPx: THRESHOLD },
		{ onFire, onCancel },
	);

describe('LongPressDetector', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('fires after the configured duration when the pointer stays still', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(10, 10);
		vi.advanceTimersByTime(DURATION);
		expect(fires).toBe(1);
	});

	it('does not fire if cancelled before the duration elapses', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(10, 10);
		detector.cancel();
		vi.advanceTimersByTime(DURATION);
		expect(fires).toBe(0);
	});

	it('cancels itself when the pointer moves beyond the threshold', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(10, 10);
		detector.move(10 + THRESHOLD + 1, 10);
		vi.advanceTimersByTime(DURATION);
		expect(fires).toBe(0);
	});

	it('keeps the timer running for movement under the threshold', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(10, 10);
		detector.move(11, 11);
		vi.advanceTimersByTime(DURATION);
		expect(fires).toBe(1);
	});

	it('only fires once even with multiple cancel calls', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(10, 10);
		vi.advanceTimersByTime(DURATION);
		detector.cancel();
		detector.cancel();
		expect(fires).toBe(1);
	});

	it('reports isActive while the timer is pending', () => {
		const detector = makeDetector();
		expect(detector.isActive()).toBe(false);
		detector.start(0, 0);
		expect(detector.isActive()).toBe(true);
		vi.advanceTimersByTime(DURATION);
		expect(detector.isActive()).toBe(false);
	});

	it('replaces a pending detection when start is called again', () => {
		let fires = 0;
		const detector = makeDetector(() => fires++);
		detector.start(0, 0);
		vi.advanceTimersByTime(DURATION / 2);
		detector.start(100, 100);
		vi.advanceTimersByTime(DURATION / 2);
		expect(fires).toBe(0);
		vi.advanceTimersByTime(DURATION / 2);
		expect(fires).toBe(1);
	});

	it('calls onCancel when an active detection is cancelled', () => {
		let cancels = 0;
		const detector = makeDetector(() => {}, () => cancels++);
		detector.start(0, 0);
		detector.cancel();
		expect(cancels).toBe(1);
	});

	it('calls onCancel when movement past the threshold triggers cancellation', () => {
		let cancels = 0;
		const detector = makeDetector(() => {}, () => cancels++);
		detector.start(0, 0);
		detector.move(THRESHOLD + 1, 0);
		expect(cancels).toBe(1);
	});

	it('does not call onCancel when there was no active detection', () => {
		let cancels = 0;
		const detector = makeDetector(() => {}, () => cancels++);
		detector.cancel();
		expect(cancels).toBe(0);
	});
});
