import type { Tool } from './palette';

export interface NormalizedPoint {
	x: number;
	y: number;
	pressure: number;
}

export interface Stroke {
	points: NormalizedPoint[];
	color: string;
	width: number;
	tool: Tool;
}

export interface CanvasSize {
	width: number;
	height: number;
}

export type SegmentEmit = (a: NormalizedPoint, b: NormalizedPoint) => void;

export const PRESSURE_MIN_FACTOR = 0.5;
export const PRESSURE_MAX_FACTOR = 1.8;
export const HIGHLIGHTER_ALPHA = 0.35;
export const HIGHLIGHTER_WIDTH_FACTOR = 4;
export const ERASE_RADIUS = 0.02;
export const SMOOTH_SUBDIVISIONS = 6;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function widthFactorForPressure(pressure: number): number {
	const t = clamp01(pressure);
	return PRESSURE_MIN_FACTOR + (PRESSURE_MAX_FACTOR - PRESSURE_MIN_FACTOR) * t;
}

export function midpoint(a: NormalizedPoint, b: NormalizedPoint): NormalizedPoint {
	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
		pressure: (a.pressure + b.pressure) / 2,
	};
}

export function subdivideQuadratic(
	start: NormalizedPoint,
	control: NormalizedPoint,
	end: NormalizedPoint,
	steps: number,
	emit: SegmentEmit,
) {
	let previous = start;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const next = quadraticAt(start, control, end, t);
		emit(previous, next);
		previous = next;
	}
}

function quadraticAt(
	start: NormalizedPoint,
	control: NormalizedPoint,
	end: NormalizedPoint,
	t: number,
): NormalizedPoint {
	const inv = 1 - t;
	return {
		x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
		y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
		pressure: inv * start.pressure + t * end.pressure,
	};
}

export function forEachSmoothSegment(points: NormalizedPoint[], emit: SegmentEmit) {
	if (points.length < 2) return;
	const first = points[0]!;
	const second = points[1]!;
	if (points.length === 2) {
		emit(first, second);
		return;
	}
	let previousMidpoint = midpoint(first, second);
	emit(first, previousMidpoint);
	for (let i = 1; i < points.length - 1; i++) {
		const control = points[i]!;
		const nextMidpoint = midpoint(control, points[i + 1]!);
		subdivideQuadratic(previousMidpoint, control, nextMidpoint, SMOOTH_SUBDIVISIONS, emit);
		previousMidpoint = nextMidpoint;
	}
	emit(previousMidpoint, points[points.length - 1]!);
}

export function strokeIntersects(stroke: Stroke, x: number, y: number, radius: number): boolean {
	const radiusSquared = radius * radius;
	return stroke.points.some((point) => {
		const dx = point.x - x;
		const dy = point.y - y;
		return dx * dx + dy * dy < radiusSquared;
	});
}

function denormalize(point: NormalizedPoint, canvas: CanvasSize) {
	return { x: point.x * canvas.width, y: point.y * canvas.height };
}

function pressureScaledWidth(a: NormalizedPoint, b: NormalizedPoint, baseWidth: number, canvas: CanvasSize): number {
	const averagePressure = (a.pressure + b.pressure) / 2;
	return baseWidth * widthFactorForPressure(averagePressure) * canvas.height;
}

export function drawSegment(
	ctx: CanvasRenderingContext2D,
	a: NormalizedPoint,
	b: NormalizedPoint,
	color: string,
	baseWidth: number,
	canvas: CanvasSize,
) {
	ctx.lineWidth = pressureScaledWidth(a, b, baseWidth, canvas);
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	const start = denormalize(a, canvas);
	const end = denormalize(b, canvas);
	ctx.beginPath();
	ctx.moveTo(start.x, start.y);
	ctx.lineTo(end.x, end.y);
	ctx.stroke();
}

export function drawHighlighterPolyline(
	ctx: CanvasRenderingContext2D,
	points: NormalizedPoint[],
	color: string,
	baseWidth: number,
	canvas: CanvasSize,
) {
	if (points.length < 2) return;
	ctx.save();
	ctx.lineWidth = baseWidth * HIGHLIGHTER_WIDTH_FACTOR * canvas.height;
	ctx.strokeStyle = color;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.globalAlpha = HIGHLIGHTER_ALPHA;
	ctx.beginPath();
	const head = denormalize(points[0]!, canvas);
	ctx.moveTo(head.x, head.y);
	for (let i = 1; i < points.length; i++) {
		const next = denormalize(points[i]!, canvas);
		ctx.lineTo(next.x, next.y);
	}
	ctx.stroke();
	ctx.restore();
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, canvas: CanvasSize) {
	if (stroke.tool === 'highlighter') {
		drawHighlighterPolyline(ctx, stroke.points, stroke.color, stroke.width, canvas);
		return;
	}
	forEachSmoothSegment(stroke.points, (a, b) => {
		drawSegment(ctx, a, b, stroke.color, stroke.width, canvas);
	});
}
