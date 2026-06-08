/* eslint-disable obsidianmd/prefer-active-doc, obsidianmd/no-static-styles-assignment */
import { describe, expect, it } from 'vitest';
import {
	applyBackingStoreSize,
	devicePixelRatioFor,
	readCanvasSurface,
} from '../src/canvas-surface';

function makeCanvas(): HTMLCanvasElement {
	return document.createElement('canvas');
}

describe('devicePixelRatioFor', () => {
	it('returns the host value when positive', () => {
		expect(devicePixelRatioFor({ devicePixelRatio: 2 })).toBe(2);
		expect(devicePixelRatioFor({ devicePixelRatio: 3 })).toBe(3);
	});
	it('returns 1 when devicePixelRatio is missing', () => {
		expect(devicePixelRatioFor({})).toBe(1);
	});
	it('returns 1 when devicePixelRatio is zero or negative', () => {
		expect(devicePixelRatioFor({ devicePixelRatio: 0 })).toBe(1);
		expect(devicePixelRatioFor({ devicePixelRatio: -1 })).toBe(1);
	});
	it('returns 1 when devicePixelRatio is not a number', () => {
		expect(devicePixelRatioFor({ devicePixelRatio: NaN })).toBe(1);
	});
});

describe('applyBackingStoreSize', () => {
	it('scales the backing store by the device pixel ratio', () => {
		const canvas = makeCanvas();
		applyBackingStoreSize(canvas, 800, 600, 2);
		expect(canvas.width).toBe(1600);
		expect(canvas.height).toBe(1200);
	});
	it('keeps the backing store equal to CSS pixels when dpr is 1', () => {
		const canvas = makeCanvas();
		applyBackingStoreSize(canvas, 400, 300, 1);
		expect(canvas.width).toBe(400);
		expect(canvas.height).toBe(300);
	});
	it('rounds fractional pixel sizes', () => {
		const canvas = makeCanvas();
		applyBackingStoreSize(canvas, 100.4, 100.6, 2);
		expect(canvas.width).toBe(201);
		expect(canvas.height).toBe(201);
	});
	it('returns true when dimensions change', () => {
		const canvas = makeCanvas();
		expect(applyBackingStoreSize(canvas, 100, 100, 2)).toBe(true);
	});
	it('returns false when dimensions are already at the target', () => {
		const canvas = makeCanvas();
		applyBackingStoreSize(canvas, 100, 100, 2);
		expect(applyBackingStoreSize(canvas, 100, 100, 2)).toBe(false);
	});
});

describe('readCanvasSurface', () => {
	it('returns CSS dimensions from the style and computes the dpr', () => {
		const canvas = makeCanvas();
		canvas.width = 1600;
		canvas.height = 1200;
		canvas.style.width = '800px';
		canvas.style.height = '600px';
		const surface = readCanvasSurface(canvas);
		expect(surface.width).toBe(800);
		expect(surface.height).toBe(600);
		expect(surface.dpr).toBe(2);
	});
	it('falls back to backing-store dimensions when style is missing', () => {
		const canvas = makeCanvas();
		canvas.width = 400;
		canvas.height = 300;
		const surface = readCanvasSurface(canvas);
		expect(surface.width).toBe(400);
		expect(surface.height).toBe(300);
		expect(surface.dpr).toBe(1);
	});
	it('treats zero-width style as missing', () => {
		const canvas = makeCanvas();
		canvas.width = 200;
		canvas.height = 100;
		canvas.style.width = '0px';
		canvas.style.height = '0px';
		const surface = readCanvasSurface(canvas);
		expect(surface.width).toBe(200);
		expect(surface.height).toBe(100);
		expect(surface.dpr).toBe(1);
	});
	it('round-trips with applyBackingStoreSize so writing then reading recovers CSS size and dpr', () => {
		const canvas = makeCanvas();
		applyBackingStoreSize(canvas, 1024, 768, 3);
		canvas.style.width = '1024px';
		canvas.style.height = '768px';
		const surface = readCanvasSurface(canvas);
		expect(surface.width).toBe(1024);
		expect(surface.height).toBe(768);
		expect(surface.dpr).toBe(3);
	});
});
