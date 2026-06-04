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

// Pressure (0..1) scales the per-segment width by this factor range. The
// floor keeps a barely-touching stroke visible; the ceiling gives a clear
// heavy-press marker. Mouse input reports pressure 0.5 (button down), which
// lands near the middle of the range, so desktop testing looks normal.
export const PRESSURE_MIN_FACTOR = 0.5;
export const PRESSURE_MAX_FACTOR = 1.8;

export const HIGHLIGHTER_ALPHA = 0.35;
// Highlighter strokes render at this multiple of the chosen pen width so the
// thinnest preset still looks like a marker, not a thick pen line.
export const HIGHLIGHTER_WIDTH_FACTOR = 4;

// Whole-stroke eraser hit radius, as a fraction of page height.
export const ERASE_RADIUS = 0.02;

export function widthFactorForPressure(pressure: number): number {
	const p = Math.max(0, Math.min(1, pressure));
	return PRESSURE_MIN_FACTOR + (PRESSURE_MAX_FACTOR - PRESSURE_MIN_FACTOR) * p;
}

export function drawSegment(
	ctx: CanvasRenderingContext2D,
	a: NormalizedPoint,
	b: NormalizedPoint,
	_tool: Tool,
	color: string,
	baseWidth: number,
	canvasWidth: number,
	canvasHeight: number,
) {
	const avgPressure = (a.pressure + b.pressure) / 2;
	ctx.lineWidth = baseWidth * widthFactorForPressure(avgPressure) * canvasHeight;
	ctx.strokeStyle = color;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.beginPath();
	ctx.moveTo(a.x * canvasWidth, a.y * canvasHeight);
	ctx.lineTo(b.x * canvasWidth, b.y * canvasHeight);
	ctx.stroke();
}

export function drawHighlighterPolyline(
	ctx: CanvasRenderingContext2D,
	points: NormalizedPoint[],
	color: string,
	baseWidth: number,
	canvasWidth: number,
	canvasHeight: number,
) {
	if (points.length < 2) return;
	ctx.save();
	ctx.lineWidth = baseWidth * HIGHLIGHTER_WIDTH_FACTOR * canvasHeight;
	ctx.strokeStyle = color;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.globalAlpha = HIGHLIGHTER_ALPHA;
	ctx.beginPath();
	const first = points[0];
	if (!first) {
		ctx.restore();
		return;
	}
	ctx.moveTo(first.x * canvasWidth, first.y * canvasHeight);
	for (let i = 1; i < points.length; i++) {
		const p = points[i];
		if (!p) continue;
		ctx.lineTo(p.x * canvasWidth, p.y * canvasHeight);
	}
	ctx.stroke();
	ctx.restore();
}

// How many sub-segments to use per quadratic Bézier curve when subdividing
// for smooth rendering. Higher = smoother curve, more line draws.
export const SMOOTH_SUBDIVISIONS = 6;

export function midpoint(a: NormalizedPoint, b: NormalizedPoint): NormalizedPoint {
	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
		pressure: (a.pressure + b.pressure) / 2,
	};
}

// Subdivides a quadratic Bézier (p0, control, p2) into small straight
// segments and emits each via the provided callback. Pressure is linearly
// interpolated between the endpoints so the per-segment width follows the
// same pressure curve as the original recorded points.
export function subdivideQuadratic(
	p0: NormalizedPoint,
	control: NormalizedPoint,
	p2: NormalizedPoint,
	steps: number,
	emit: (a: NormalizedPoint, b: NormalizedPoint) => void,
) {
	let prev = p0;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		const inv = 1 - t;
		const sub: NormalizedPoint = {
			x: inv * inv * p0.x + 2 * inv * t * control.x + t * t * p2.x,
			y: inv * inv * p0.y + 2 * inv * t * control.y + t * t * p2.y,
			pressure: inv * p0.pressure + t * p2.pressure,
		};
		emit(prev, sub);
		prev = sub;
	}
}

// Walks a pen stroke and emits the smoothed segments. The curve passes
// through midpoints of consecutive recorded points, using each recorded
// point as the quadratic Bézier control — pulls the curve toward what the
// user drew while rounding off the jagged inter-sample joints.
export function forEachSmoothSegment(
	points: NormalizedPoint[],
	emit: (a: NormalizedPoint, b: NormalizedPoint) => void,
) {
	if (points.length < 2) return;
	const first = points[0];
	const second = points[1];
	if (!first || !second) return;
	if (points.length === 2) {
		emit(first, second);
		return;
	}
	let prevMid = midpoint(first, second);
	emit(first, prevMid);
	for (let i = 1; i < points.length - 1; i++) {
		const ctrl = points[i];
		const next = points[i + 1];
		if (!ctrl || !next) continue;
		const newMid = midpoint(ctrl, next);
		subdivideQuadratic(prevMid, ctrl, newMid, SMOOTH_SUBDIVISIONS, emit);
		prevMid = newMid;
	}
	const last = points[points.length - 1];
	if (last) emit(prevMid, last);
}

export function drawStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	width: number,
	height: number,
) {
	if (stroke.tool === 'highlighter') {
		drawHighlighterPolyline(
			ctx,
			stroke.points,
			stroke.color,
			stroke.width,
			width,
			height,
		);
		return;
	}
	forEachSmoothSegment(stroke.points, (a, b) => {
		drawSegment(ctx, a, b, stroke.tool, stroke.color, stroke.width, width, height);
	});
}

export function strokeIntersects(
	stroke: Stroke,
	x: number,
	y: number,
	r: number,
): boolean {
	const r2 = r * r;
	for (const p of stroke.points) {
		const dx = p.x - x;
		const dy = p.y - y;
		if (dx * dx + dy * dy < r2) return true;
	}
	return false;
}
