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
	let prev: NormalizedPoint | null = null;
	for (const p of stroke.points) {
		if (prev) {
			drawSegment(
				ctx,
				prev,
				p,
				stroke.tool,
				stroke.color,
				stroke.width,
				width,
				height,
			);
		}
		prev = p;
	}
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
