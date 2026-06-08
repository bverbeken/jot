import {
	NormalizedPoint,
	Stroke,
	forEachSmoothSegment,
	widthFactorForPressure,
} from './stroke-math';

export interface CanvasSize {
	width: number;
	height: number;
	dpr?: number;
}

export const HIGHLIGHTER_ALPHA = 0.35;
export const HIGHLIGHTER_WIDTH_FACTOR = 4;

function denormalize(point: NormalizedPoint, canvas: CanvasSize) {
	return { x: point.x * canvas.width, y: point.y * canvas.height };
}

function applyDprTransform(ctx: CanvasRenderingContext2D, canvas: CanvasSize) {
	const dpr = canvas.dpr ?? 1;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function pressureScaledWidth(
	a: NormalizedPoint,
	b: NormalizedPoint,
	baseWidth: number,
	canvas: CanvasSize,
): number {
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
	applyDprTransform(ctx, canvas);
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
	applyDprTransform(ctx, canvas);
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
