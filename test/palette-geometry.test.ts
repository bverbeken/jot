import { describe, expect, it } from 'vitest';
import {
	ANCHOR_OFFSET_PX,
	MAIN_ARC_RADIUS,
	MAIN_ITEM_COUNT,
	MAIN_ITEM_STEP_RAD,
	SUB_ARC_RADIUS,
	SUB_ITEM_STEP_RAD,
	arcBounds,
	arcCenterAngle,
	arcCenterlinePath,
	arcOrigin,
	clampAxis,
	mainSlotOffset,
	slotAngle,
	subSlotOffset,
} from '../src/palette-geometry';

const toDeg = (rad: number) => (rad * 180) / Math.PI;

describe('arcCenterAngle', () => {
	it('places a right-handed upward fan 20° left of straight up at 250°', () => {
		expect(toDeg(arcCenterAngle('right', false))).toBeCloseTo(250);
	});
	it('places a left-handed upward fan 20° right of straight up at 290°', () => {
		expect(toDeg(arcCenterAngle('left', false))).toBeCloseTo(290);
	});
	it('mirrors the right-handed downward fan to 110° (still tilted away from the pen hand)', () => {
		expect(toDeg(arcCenterAngle('right', true))).toBeCloseTo(110);
	});
	it('mirrors the left-handed downward fan to 70° (still tilted away from the pen hand)', () => {
		expect(toDeg(arcCenterAngle('left', true))).toBeCloseTo(70);
	});
});

describe('arcOrigin', () => {
	it('sits ANCHOR_OFFSET_PX behind the press point along the reverse fan direction', () => {
		const origin = arcOrigin('right', false);
		const distance = Math.hypot(origin.ox, origin.oy);
		expect(distance).toBeCloseTo(ANCHOR_OFFSET_PX);
	});
	it('places the right-handed upward origin below and to the right of the press point', () => {
		const origin = arcOrigin('right', false);
		expect(origin.ox).toBeGreaterThan(0);
		expect(origin.oy).toBeGreaterThan(0);
	});
	it('mirrors the left-handed upward origin to below and to the left', () => {
		const origin = arcOrigin('left', false);
		expect(origin.ox).toBeLessThan(0);
		expect(origin.oy).toBeGreaterThan(0);
	});
});

describe('slotAngle', () => {
	it('places the center slot at the fan center', () => {
		const center = (MAIN_ITEM_COUNT - 1) / 2;
		expect(slotAngle(center, 'right', false)).toBeCloseTo(arcCenterAngle('right', false));
	});
	it('steps each slot by ITEM_ANGULAR_DEG away from the center', () => {
		const center = (MAIN_ITEM_COUNT - 1) / 2;
		const stepFromCenter =
			slotAngle(center + 1, 'right', false) - slotAngle(center, 'right', false);
		expect(stepFromCenter).toBeCloseTo(MAIN_ITEM_STEP_RAD);
	});
});

describe('mainSlotOffset', () => {
	it('places slots at distance MAIN_ARC_RADIUS from the arc origin', () => {
		const origin = arcOrigin('right', false);
		const slot = mainSlotOffset(0, 'right', false);
		const distanceFromOrigin = Math.hypot(slot.ox - origin.ox, slot.oy - origin.oy);
		expect(distanceFromOrigin).toBeCloseTo(MAIN_ARC_RADIUS, 0);
	});
	it('produces integer coordinates (rounded for CSS)', () => {
		const slot = mainSlotOffset(2, 'right', false);
		expect(Number.isInteger(slot.ox)).toBe(true);
		expect(Number.isInteger(slot.oy)).toBe(true);
	});
});

describe('subSlotOffset', () => {
	it('places items at distance SUB_ARC_RADIUS from the arc origin', () => {
		const origin = arcOrigin('right', false);
		const item = subSlotOffset(0, 7, slotAngle(4, 'right', false), 'right', false);
		const distance = Math.hypot(item.ox - origin.ox, item.oy - origin.oy);
		expect(distance).toBeCloseTo(SUB_ARC_RADIUS, 0);
	});
	it('with one item lands exactly on the centerTheta direction', () => {
		const origin = arcOrigin('right', false);
		const centerTheta = slotAngle(2, 'right', false);
		const item = subSlotOffset(0, 1, centerTheta, 'right', false);
		const expectedX = origin.ox + SUB_ARC_RADIUS * Math.cos(centerTheta);
		const expectedY = origin.oy + SUB_ARC_RADIUS * Math.sin(centerTheta);
		expect(item.ox).toBeCloseTo(Math.round(expectedX));
		expect(item.oy).toBeCloseTo(Math.round(expectedY));
	});
	it('spaces adjacent sub items by approximately the main-arc chord length', () => {
		const a = subSlotOffset(0, 4, slotAngle(2, 'right', false), 'right', false);
		const b = subSlotOffset(1, 4, slotAngle(2, 'right', false), 'right', false);
		const subChord = Math.hypot(a.ox - b.ox, a.oy - b.oy);
		const mainChord = 2 * MAIN_ARC_RADIUS * Math.sin(MAIN_ITEM_STEP_RAD / 2);
		expect(Math.abs(subChord - mainChord)).toBeLessThan(2);
	});
	it('derives SUB_ITEM_STEP_RAD from the equal-chord condition with the main step', () => {
		const expected =
			2 * Math.asin((MAIN_ARC_RADIUS / SUB_ARC_RADIUS) * Math.sin(MAIN_ITEM_STEP_RAD / 2));
		expect(SUB_ITEM_STEP_RAD).toBeCloseTo(expected);
	});
});

describe('arcCenterlinePath', () => {
	it('starts at the start-angle point and ends at the end-angle point', () => {
		const path = arcCenterlinePath(100, 0, Math.PI / 2);
		expect(path).toMatch(/^M 100\.00 0\.00 /);
		expect(path).toMatch(/0\.00 100\.00$/);
	});
	it('flags a large-arc when the swept angle exceeds π', () => {
		const wide = arcCenterlinePath(100, 0, Math.PI + 0.1);
		expect(wide).toMatch(/A 100 100 0 1 1/);
	});
	it('flags a small-arc when the swept angle is at or below π', () => {
		const narrow = arcCenterlinePath(100, 0, Math.PI / 4);
		expect(narrow).toMatch(/A 100 100 0 0 1/);
	});
});

describe('arcBounds', () => {
	const mainBounds = arcBounds('right', false);

	it('contains the origin and every main-arc slot', () => {
		const offsets = [arcOrigin('right', false)];
		for (let slot = 0; slot < MAIN_ITEM_COUNT; slot++) {
			offsets.push(mainSlotOffset(slot, 'right', false));
		}
		for (const { ox, oy } of offsets) {
			expect(ox).toBeGreaterThanOrEqual(mainBounds.minX);
			expect(ox).toBeLessThanOrEqual(mainBounds.maxX);
			expect(oy).toBeGreaterThanOrEqual(mainBounds.minY);
			expect(oy).toBeLessThanOrEqual(mainBounds.maxY);
		}
	});

	it('only grows when a sub-arc is included', () => {
		const withSub = arcBounds('right', false, [{ slot: 4, count: 7 }]);
		expect(withSub.minX).toBeLessThanOrEqual(mainBounds.minX);
		expect(withSub.maxX).toBeGreaterThanOrEqual(mainBounds.maxX);
		expect(withSub.minY).toBeLessThanOrEqual(mainBounds.minY);
		expect(withSub.maxY).toBeGreaterThanOrEqual(mainBounds.maxY);
	});

	it('spans wider than the main arc alone once a 7-color sub-arc opens', () => {
		const withSub = arcBounds('right', false, [{ slot: 4, count: 7 }]);
		const mainSpan = mainBounds.maxX - mainBounds.minX;
		const subSpan = withSub.maxX - withSub.minX;
		expect(subSpan).toBeGreaterThan(mainSpan);
	});
});

describe('clampAxis', () => {
	// lo = pad - minOff = 120, hi = extent - pad - maxOff = 880
	it('leaves a position that already fits untouched', () => {
		expect(clampAxis(500, -100, 100, 1000, 20)).toBe(500);
	});
	it('pushes a position off the leading edge inward to the low bound', () => {
		expect(clampAxis(50, -100, 100, 1000, 20)).toBe(120);
	});
	it('pushes a position off the trailing edge inward to the high bound', () => {
		expect(clampAxis(950, -100, 100, 1000, 20)).toBe(880);
	});
	it('centers the fan when it is larger than the viewport on this axis', () => {
		// lo = 120, hi = 150 - 20 - 100 = 30 → lo > hi → center at 75
		expect(clampAxis(0, -100, 100, 150, 20)).toBe(75);
	});

	it('keeps the real fan extents within the viewport after clamping', () => {
		const bounds = arcBounds('right', false, [{ slot: 4, count: 7 }]);
		const pad = 36;
		const innerWidth = 800;
		const innerHeight = 600;
		// Trigger hard in the top-left corner.
		const x = clampAxis(2, bounds.minX, bounds.maxX, innerWidth, pad);
		const y = clampAxis(2, bounds.minY, bounds.maxY, innerHeight, pad);
		expect(x + bounds.minX).toBeGreaterThanOrEqual(pad);
		expect(x + bounds.maxX).toBeLessThanOrEqual(innerWidth - pad);
		expect(y + bounds.minY).toBeGreaterThanOrEqual(pad);
		expect(y + bounds.maxY).toBeLessThanOrEqual(innerHeight - pad);
	});
});
