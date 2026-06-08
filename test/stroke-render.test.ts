import { describe, expect, it, vi } from 'vitest';
import type { NormalizedPoint, Stroke } from '../src/stroke-math';
import {
	HIGHLIGHTER_WIDTH_FACTOR,
	drawHighlighterPolyline,
	drawSegment,
	drawStroke,
} from '../src/stroke-render';

const point = (x: number, y: number, pressure = 1): NormalizedPoint => ({ x, y, pressure });

function makeCtx() {
	return {
		setTransform: vi.fn(),
		clearRect: vi.fn(),
		beginPath: vi.fn(),
		moveTo: vi.fn(),
		lineTo: vi.fn(),
		stroke: vi.fn(),
		save: vi.fn(),
		restore: vi.fn(),
		lineWidth: 0,
		strokeStyle: '',
		lineCap: 'butt' as CanvasLineCap,
		lineJoin: 'miter' as CanvasLineJoin,
		globalAlpha: 1,
	};
}

describe('drawSegment', () => {
	it('applies the device pixel ratio as a transform before drawing', () => {
		const ctx = makeCtx();
		drawSegment(
			ctx as unknown as CanvasRenderingContext2D,
			point(0, 0),
			point(1, 1),
			'#000',
			0.01,
			{ width: 800, height: 600, dpr: 2 },
		);
		expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
	});
	it('uses an identity transform when no dpr is supplied', () => {
		const ctx = makeCtx();
		drawSegment(
			ctx as unknown as CanvasRenderingContext2D,
			point(0, 0),
			point(1, 1),
			'#000',
			0.01,
			{ width: 800, height: 600 },
		);
		expect(ctx.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
	});
	it('denormalizes coordinates against the CSS dimensions, not the backing store', () => {
		const ctx = makeCtx();
		drawSegment(
			ctx as unknown as CanvasRenderingContext2D,
			point(0.25, 0.5),
			point(0.75, 1),
			'#000',
			0.01,
			{ width: 800, height: 600, dpr: 2 },
		);
		expect(ctx.moveTo).toHaveBeenCalledWith(200, 300);
		expect(ctx.lineTo).toHaveBeenCalledWith(600, 600);
	});
	it('computes line width from CSS height so DPR does not double thickness', () => {
		const cssCtx = makeCtx();
		drawSegment(
			cssCtx as unknown as CanvasRenderingContext2D,
			point(0, 0, 1),
			point(1, 1, 1),
			'#000',
			0.01,
			{ width: 800, height: 600, dpr: 2 },
		);
		const dprOneCtx = makeCtx();
		drawSegment(
			dprOneCtx as unknown as CanvasRenderingContext2D,
			point(0, 0, 1),
			point(1, 1, 1),
			'#000',
			0.01,
			{ width: 800, height: 600, dpr: 1 },
		);
		expect(cssCtx.lineWidth).toBe(dprOneCtx.lineWidth);
	});
});

describe('drawHighlighterPolyline', () => {
	it('applies the dpr transform before drawing', () => {
		const ctx = makeCtx();
		drawHighlighterPolyline(
			ctx as unknown as CanvasRenderingContext2D,
			[point(0, 0), point(1, 1)],
			'#ff0',
			0.005,
			{ width: 800, height: 600, dpr: 2 },
		);
		expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
	});
	it('uses CSS height for line width regardless of dpr', () => {
		const ctx = makeCtx();
		drawHighlighterPolyline(
			ctx as unknown as CanvasRenderingContext2D,
			[point(0, 0), point(1, 1)],
			'#ff0',
			0.005,
			{ width: 800, height: 600, dpr: 3 },
		);
		expect(ctx.lineWidth).toBe(0.005 * HIGHLIGHTER_WIDTH_FACTOR * 600);
	});
	it('does nothing for fewer than two points', () => {
		const ctx = makeCtx();
		drawHighlighterPolyline(
			ctx as unknown as CanvasRenderingContext2D,
			[point(0, 0)],
			'#ff0',
			0.005,
			{ width: 800, height: 600, dpr: 2 },
		);
		expect(ctx.setTransform).not.toHaveBeenCalled();
		expect(ctx.stroke).not.toHaveBeenCalled();
	});
});

describe('drawStroke', () => {
	it('routes pen strokes through the segmented path with the dpr transform', () => {
		const ctx = makeCtx();
		const stroke: Stroke = {
			points: [point(0, 0), point(0.5, 0.5), point(1, 1)],
			color: '#000',
			width: 0.01,
			tool: 'pen',
		};
		drawStroke(ctx as unknown as CanvasRenderingContext2D, stroke, {
			width: 800,
			height: 600,
			dpr: 2,
		});
		expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
		expect(ctx.stroke).toHaveBeenCalled();
	});
	it('routes highlighter strokes through the polyline path with the dpr transform', () => {
		const ctx = makeCtx();
		const stroke: Stroke = {
			points: [point(0, 0), point(1, 1)],
			color: '#ff0',
			width: 0.005,
			tool: 'highlighter',
		};
		drawStroke(ctx as unknown as CanvasRenderingContext2D, stroke, {
			width: 800,
			height: 600,
			dpr: 2,
		});
		expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
	});
});
