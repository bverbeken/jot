import { describe, expect, it } from 'vitest';
import { StylusGestureGuard } from '../src/stylus-gesture-guard';

describe('StylusGestureGuard', () => {
	it('blocks iPadOS stylus touches', () => {
		const guard = new StylusGestureGuard();
		expect(guard.shouldBlock([{ touchType: 'stylus' }])).toBe(true);
	});

	it('lets finger touches scroll when no pen is down', () => {
		const guard = new StylusGestureGuard();
		expect(guard.shouldBlock([{ touchType: 'direct' }, {}])).toBe(false);
		expect(guard.shouldBlock([])).toBe(false);
	});

	it('blocks touches while a pen pointer is down, even without touchType', () => {
		const guard = new StylusGestureGuard();
		guard.penDown(7);
		expect(guard.shouldBlock([{}])).toBe(true);
	});

	it('stops blocking once the pen lifts', () => {
		const guard = new StylusGestureGuard();
		guard.penDown(7);
		guard.penUp(7);
		expect(guard.shouldBlock([{}])).toBe(false);
	});

	it('keeps blocking until every pen pointer has lifted', () => {
		const guard = new StylusGestureGuard();
		guard.penDown(1);
		guard.penDown(2);
		guard.penUp(1);
		expect(guard.shouldBlock([{}])).toBe(true);
		guard.penUp(2);
		expect(guard.shouldBlock([{}])).toBe(false);
	});

	it('stops blocking after a reset even if a pen never reported lifting', () => {
		const guard = new StylusGestureGuard();
		guard.penDown(3);
		guard.reset();
		expect(guard.shouldBlock([{}])).toBe(false);
	});
});
