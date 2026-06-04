const HOLD_INDICATOR_CLASS = 'jot-hold-indicator';
const DURATION_CSS_VAR = '--jot-hold-duration';
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_VIEW_BOX = '0 0 28 28';
const RING_CX = '14';
const RING_CY = '14';
const RING_RADIUS = '12';

export function createHoldIndicator(
	doc: Document,
	clientX: number,
	clientY: number,
	durationMs: number,
): HTMLElement {
	const el = doc.createElement('div');
	el.className = HOLD_INDICATOR_CLASS;
	el.style.left = `${clientX}px`;
	el.style.top = `${clientY}px`;
	el.style.setProperty(DURATION_CSS_VAR, `${durationMs}ms`);
	el.appendChild(buildRingSvg(doc));
	return el;
}

function buildRingSvg(doc: Document): SVGElement {
	const svg = doc.createElementNS(SVG_NS, 'svg');
	svg.setAttribute('viewBox', SVG_VIEW_BOX);
	svg.appendChild(buildRingCircle(doc));
	return svg;
}

function buildRingCircle(doc: Document): SVGCircleElement {
	const circle = doc.createElementNS(SVG_NS, 'circle');
	circle.setAttribute('cx', RING_CX);
	circle.setAttribute('cy', RING_CY);
	circle.setAttribute('r', RING_RADIUS);
	return circle;
}
