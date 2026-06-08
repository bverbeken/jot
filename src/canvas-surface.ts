export interface CanvasSurface {
	width: number;
	height: number;
	dpr: number;
}

export function devicePixelRatioFor(host: { devicePixelRatio?: number }): number {
	const value = host.devicePixelRatio;
	return typeof value === 'number' && value > 0 ? value : 1;
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
