import type { Handedness } from './palette';

export interface Offset {
	ox: number;
	oy: number;
}

export const MAIN_ARC_RADIUS = 110;
export const SUB_ARC_RADIUS = 166;
export const ANCHOR_OFFSET_PX = 60;
export const RADIAL_MARGIN_PX = 16;
export const MAIN_ITEM_COUNT = 5;
export const BG_ANGULAR_PAD_DEG = 4;
export const SVG_HALF = 280;

const TILT_OFFSET_DEG = 20;
const ITEM_ANGULAR_DEG = 24;

export const MAIN_ITEM_STEP_RAD = (ITEM_ANGULAR_DEG * Math.PI) / 180;
export const SUB_ITEM_STEP_RAD = 2 * Math.asin((MAIN_ARC_RADIUS / SUB_ARC_RADIUS) * Math.sin(MAIN_ITEM_STEP_RAD / 2));

const STRAIGHT_UP_RAD = (3 * Math.PI) / 2;
const STRAIGHT_DOWN_RAD = Math.PI / 2;
const TILT_RAD = (TILT_OFFSET_DEG * Math.PI) / 180;

export function arcCenterAngle(handedness: Handedness, flipDown: boolean): number {
	const base = flipDown ? STRAIGHT_DOWN_RAD : STRAIGHT_UP_RAD;
	const awayFromHand = handedness === 'right' ? -TILT_RAD : TILT_RAD;
	return flipDown ? base - awayFromHand : base + awayFromHand;
}

export function arcOrigin(handedness: Handedness, flipDown: boolean): Offset {
	const center = arcCenterAngle(handedness, flipDown);
	return {
		ox: -ANCHOR_OFFSET_PX * Math.cos(center),
		oy: -ANCHOR_OFFSET_PX * Math.sin(center),
	};
}

export function slotAngle(slot: number, handedness: Handedness, flipDown: boolean): number {
	const center = arcCenterAngle(handedness, flipDown);
	const offsetFromCenter = slot - (MAIN_ITEM_COUNT - 1) / 2;
	return center + offsetFromCenter * MAIN_ITEM_STEP_RAD;
}

export function mainSlotOffset(slot: number, handedness: Handedness, flipDown: boolean): Offset {
	const origin = arcOrigin(handedness, flipDown);
	const theta = slotAngle(slot, handedness, flipDown);
	return {
		ox: Math.round(origin.ox + MAIN_ARC_RADIUS * Math.cos(theta)),
		oy: Math.round(origin.oy + MAIN_ARC_RADIUS * Math.sin(theta)),
	};
}

export function subSlotOffset(
	index: number,
	count: number,
	centerTheta: number,
	handedness: Handedness,
	flipDown: boolean,
): Offset {
	const origin = arcOrigin(handedness, flipDown);
	const span = (count - 1) * SUB_ITEM_STEP_RAD;
	const theta =
		count === 1 ? centerTheta : centerTheta - span / 2 + index * SUB_ITEM_STEP_RAD;
	return {
		ox: Math.round(origin.ox + SUB_ARC_RADIUS * Math.cos(theta)),
		oy: Math.round(origin.oy + SUB_ARC_RADIUS * Math.sin(theta)),
	};
}

export interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/**
 * Bounding box (in offset space, relative to the press anchor) of the centers
 * of every item the palette can render: the origin/close button, the five
 * main-arc slots, and the items of each sub-arc that may open. Used to keep
 * the whole fan on-screen regardless of where it is triggered.
 */
export function arcBounds(
	handedness: Handedness,
	flipDown: boolean,
	subArcs: { slot: number; count: number }[] = [],
): Bounds {
	const offsets: Offset[] = [arcOrigin(handedness, flipDown)];
	for (let slot = 0; slot < MAIN_ITEM_COUNT; slot++) {
		offsets.push(mainSlotOffset(slot, handedness, flipDown));
	}
	for (const { slot, count } of subArcs) {
		const centerTheta = slotAngle(slot, handedness, flipDown);
		for (let i = 0; i < count; i++) {
			offsets.push(subSlotOffset(i, count, centerTheta, handedness, flipDown));
		}
	}
	let minX = Infinity;
	let maxX = -Infinity;
	let minY = Infinity;
	let maxY = -Infinity;
	for (const { ox, oy } of offsets) {
		if (ox < minX) minX = ox;
		if (ox > maxX) maxX = ox;
		if (oy < minY) minY = oy;
		if (oy > maxY) maxY = oy;
	}
	return { minX, maxX, minY, maxY };
}

/**
 * Shift a press coordinate so the palette's extent on one axis stays within
 * `[pad, extent - pad]`. `minOff`/`maxOff` are the item-center bounds relative
 * to the anchor; `pad` covers item half-size and screen margin. If the fan is
 * larger than the viewport on this axis, it is centered instead.
 */
export function clampAxis(
	pos: number,
	minOff: number,
	maxOff: number,
	extent: number,
	pad: number,
): number {
	const lo = pad - minOff;
	const hi = extent - pad - maxOff;
	if (lo > hi) return (lo + hi) / 2;
	return Math.min(Math.max(pos, lo), hi);
}

export function arcCenterlinePath(radius: number, startAngle: number, endAngle: number): string {
	const start = pointOnArc(radius, startAngle);
	const end = pointOnArc(radius, endAngle);
	const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
	return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function pointOnArc(radius: number, angle: number): { x: number; y: number } {
	return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}
