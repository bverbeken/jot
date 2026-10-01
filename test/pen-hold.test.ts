import { describe, expect, it } from 'vitest';
import { clampPenHoldMs, PEN_HOLD_MAX_MS, PEN_HOLD_MIN_MS } from '../src/pen-hold';

describe('clampPenHoldMs', () => {
	it('keeps values inside the allowed range', () => {
		expect(clampPenHoldMs(800)).toBe(800);
	});

	it('clamps values outside the range', () => {
		expect(clampPenHoldMs(50)).toBe(PEN_HOLD_MIN_MS);
		expect(clampPenHoldMs(99999)).toBe(PEN_HOLD_MAX_MS);
	});

	it('falls back to the minimum for missing or invalid values', () => {
		expect(clampPenHoldMs(undefined)).toBe(PEN_HOLD_MIN_MS);
		expect(clampPenHoldMs('800')).toBe(PEN_HOLD_MIN_MS);
		expect(clampPenHoldMs(NaN)).toBe(PEN_HOLD_MIN_MS);
	});
});
