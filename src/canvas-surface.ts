export interface CanvasSurface {
	width: number;
	height: number;
	dpr: number;
}

// iOS WebKit refuses to draw on canvases larger than 4096 x 4096 pixels (by area);
// stay a little under it so rounding can't tip us over.
export const MAX_CANVAS_PIXELS = 16_000_000;

export function devicePixelRatioFor(host: { devicePixelRatio?: number }): number {
	const value = host.devicePixelRatio;
	return typeof value === 'number' && value > 0 ? value : 1;
}

/** Lowers dpr just enough that the backing store stays within maxPixels. */
export function cappedPixelRatio(
	cssWidth: number,
	cssHeight: number,
	dpr: number,
	maxPixels = MAX_CANVAS_PIXELS,
): number {
	const cssArea = cssWidth * cssHeight;
	if (cssArea <= 0) return dpr;
	return Math.min(dpr, Math.sqrt(maxPixels / cssArea));
}

export function applyBackingStoreSize(
	canvas: HTMLCanvasElement,
	cssWidth: number,
	cssHeight: number,
	dpr: number,
): boolean {
	const targetWidth = Math.round(cssWidth * dpr);
	const targetHeight = Math.round(cssHeight * dpr);
	let changed = false;
	if (canvas.width !== targetWidth) {
		canvas.width = targetWidth;
		changed = true;
	}
	if (canvas.height !== targetHeight) {
		canvas.height = targetHeight;
		changed = true;
	}
	return changed;
}

export function readCanvasSurface(canvas: HTMLCanvasElement): CanvasSurface {
	const styleW = parseFloat(canvas.style.width);
	const styleH = parseFloat(canvas.style.height);
	const cssWidth = Number.isFinite(styleW) && styleW > 0 ? styleW : canvas.width;
	const cssHeight = Number.isFinite(styleH) && styleH > 0 ? styleH : canvas.height;
	const dpr = cssWidth > 0 ? canvas.width / cssWidth : 1;
	return { width: cssWidth, height: cssHeight, dpr: dpr > 0 ? dpr : 1 };
}
