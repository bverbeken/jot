import { setIcon } from 'obsidian';

export type Tool = 'pen' | 'highlighter' | 'eraser';
export type Handedness = 'right' | 'left';

export interface ToolState {
	tool: Tool;
	color: string;
	// Fraction of page rendered height — same scale as STROKE_WIDTH in main.ts
	// so widths read consistently across zoom levels.
	width: number;
}

export const DEFAULT_TOOL_STATE: ToolState = {
	tool: 'pen',
	color: '#d33333',
	width: 0.0025,
};

export const PALETTE_COLORS = [
	'#000000',
	'#d33333',
	'#1f9d3a',
	'#1f6cd3',
	'#f5c518',
	'#d3338a',
	'#ffffff',
];

export const PALETTE_WIDTHS = [0.0015, 0.0025, 0.005, 0.009] as const;
const MAX_PALETTE_WIDTH = PALETTE_WIDTHS[PALETTE_WIDTHS.length - 1] ?? 0.009;

const PALETTE_CLASS = 'jot-palette';

// Radii of the two arcs (px).
const MAIN_ARC_RADIUS = 110;
const SUB_ARC_RADIUS = 170;
// Buffer to keep the outer arc off the screen edge before flipping.
const RADIAL_MARGIN_PX = 16;

// Each item occupies this much arc, regardless of which arc it sits on.
// An arc with n items spans (n-1) * ITEM_ANGULAR_DEG, centered on the arc
// center angle — so 2 items get a tight fan, 7 get a wide one, with the
// same item-to-item gap in both cases.
const ITEM_ANGULAR_DEG = 24;
const MAIN_ITEM_COUNT = 4;

// Tilt away from the pen hand: 20° off straight up. Right-handed fan opens
// upper-left, left-handed upper-right. Flipped variants used when there's
// no room above the press point.
const TILT_OFFSET_DEG = 20;

// Background SVG annular sector — wider than the widest live arc so it
// surrounds the items with a small gutter.
const BG_ANGULAR_PAD_DEG = 10;
const BG_INNER_PAD_PX = 26;
const BG_OUTER_PAD_PX = 24;
const SVG_HALF = 260;

type OnChange = (state: ToolState) => void;
type SubArc = 'color' | 'tool' | 'width' | null;

function arcSpanRad(n: number): number {
	if (n <= 1) return 0;
	return ((n - 1) * ITEM_ANGULAR_DEG * Math.PI) / 180;
}

const DRAWING_TOOLS: { id: Exclude<Tool, 'eraser'>; icon: string; label: string }[] = [
	{ id: 'pen', icon: 'pencil', label: 'Pen' },
	{ id: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
];

const TOOL_ICON: Record<Tool, string> = {
	pen: 'pencil',
	highlighter: 'highlighter',
	eraser: 'eraser',
};

// Center the fan opposite the pen hand so the wrist doesn't cover the
// palette. Straight up is 270° (3π/2); we offset by TILT_OFFSET_DEG toward
// the side opposite the pen hand. Flipped down when there's no room above.
function arcCenterAngle(handedness: Handedness, flipDown: boolean): number {
	const tilt = (TILT_OFFSET_DEG * Math.PI) / 180;
	const up = (3 * Math.PI) / 2;
	const down = Math.PI / 2;
	const base = flipDown ? down : up;
	// In screen-space angles, upper-left is < 270° (i.e. base - tilt) and
	// upper-right is > 270°. Right-handers want upper-left; left-handers
	// upper-right.
	return handedness === 'right' ? base - tilt : base + tilt;
}

function annularSectorPath(
	a1: number,
	a2: number,
	innerR: number,
	outerR: number,
): string {
	const x1o = outerR * Math.cos(a1);
	const y1o = outerR * Math.sin(a1);
	const x2o = outerR * Math.cos(a2);
	const y2o = outerR * Math.sin(a2);
	const x1i = innerR * Math.cos(a1);
	const y1i = innerR * Math.sin(a1);
	const x2i = innerR * Math.cos(a2);
	const y2i = innerR * Math.sin(a2);
	const largeArc = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
	return [
		`M ${x1o.toFixed(2)} ${y1o.toFixed(2)}`,
		`A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o.toFixed(2)} ${y2o.toFixed(2)}`,
		`L ${x2i.toFixed(2)} ${y2i.toFixed(2)}`,
		`A ${innerR} ${innerR} 0 ${largeArc} 0 ${x1i.toFixed(2)} ${y1i.toFixed(2)}`,
		'Z',
	].join(' ');
}

export class Palette {
	private element: HTMLElement | null = null;
	private outsideHandler: ((e: PointerEvent) => void) | null = null;
	private outsideDoc: Document | null = null;
	private state: ToolState;
	private onChange: OnChange;
	private flipDown = false;
	private subArc: SubArc = null;
	private handedness: Handedness = 'right';
	// Last drawing tool the user picked (pen or highlighter). The main-arc
	// tool slot shows this even when eraser is the active tool, so switching
	// back to drawing is one tap, not two.
	private lastDrawingTool: Exclude<Tool, 'eraser'> = 'pen';

	constructor(initial: ToolState, onChange: OnChange) {
		this.state = { ...initial };
		this.onChange = onChange;
		if (initial.tool === 'pen' || initial.tool === 'highlighter') {
			this.lastDrawingTool = initial.tool;
		}
	}

	getState(): ToolState {
		return { ...this.state };
	}

	isOpen(): boolean {
		return this.element !== null;
	}

	show(parent: HTMLElement, clientX: number, clientY: number, handedness: Handedness) {
		this.hide();
		const doc = parent.ownerDocument;
		const win = doc.defaultView ?? window;
		this.handedness = handedness;

		// Flip the fan downward only if there's no room above the press point.
		const needed = SUB_ARC_RADIUS + RADIAL_MARGIN_PX;
		const fitsUp = clientY - needed >= RADIAL_MARGIN_PX;
		const fitsDown = clientY + needed <= win.innerHeight - RADIAL_MARGIN_PX;
		this.flipDown = !fitsUp && fitsDown;
		this.subArc = null;

		const el = doc.createElement('div');
		el.className = PALETTE_CLASS;
		el.style.left = `${clientX}px`;
		el.style.top = `${clientY}px`;
		this.renderItems(el, doc);
		parent.appendChild(el);

		this.element = el;
		this.bindOutsideClose(doc);
	}

	hide() {
		if (!this.element) return;
		this.element.remove();
		this.element = null;
		this.subArc = null;
		if (this.outsideHandler && this.outsideDoc) {
			this.outsideDoc.removeEventListener('pointerdown', this.outsideHandler, true);
			this.outsideHandler = null;
			this.outsideDoc = null;
		}
	}

	private rerender() {
		if (!this.element) return;
		const doc = this.element.ownerDocument;
		this.element.empty();
		this.renderItems(this.element, doc);
	}

	private toggleSub(which: Exclude<SubArc, null>) {
		this.subArc = this.subArc === which ? null : which;
		this.rerender();
	}

	private renderItems(host: HTMLElement, doc: Document) {
		this.renderBackground(host, doc);

		const n = MAIN_ITEM_COUNT;
		this.renderColorSlot(host, doc, this.itemOffset(0, n, MAIN_ARC_RADIUS));
		this.renderToolSlot(host, doc, this.itemOffset(1, n, MAIN_ARC_RADIUS));
		this.renderEraserSlot(host, doc, this.itemOffset(2, n, MAIN_ARC_RADIUS));
		this.renderWidthSlot(host, doc, this.itemOffset(3, n, MAIN_ARC_RADIUS));

		if (this.subArc === 'color') this.renderSubColors(host, doc);
		else if (this.subArc === 'tool') this.renderSubTools(host, doc);
		else if (this.subArc === 'width') this.renderSubWidths(host, doc);
	}

	private renderBackground(host: HTMLElement, doc: Document) {
		const center = arcCenterAngle(this.handedness, this.flipDown);
		const subCount = this.subArcItemCount();
		const widestSpan = Math.max(arcSpanRad(MAIN_ITEM_COUNT), arcSpanRad(subCount));
		const pad = (BG_ANGULAR_PAD_DEG * Math.PI) / 180;
		const a1 = center - widestSpan / 2 - pad;
		const a2 = center + widestSpan / 2 + pad;
		const innerR = MAIN_ARC_RADIUS - BG_INNER_PAD_PX;
		const outerArcR = subCount === 0 ? MAIN_ARC_RADIUS : SUB_ARC_RADIUS;
		const outerR = outerArcR + BG_OUTER_PAD_PX;

		const ns = 'http://www.w3.org/2000/svg';
		const svg = doc.createElementNS(ns, 'svg');
		svg.setAttribute('class', 'jot-palette-bg');
		svg.setAttribute(
			'viewBox',
			`${-SVG_HALF} ${-SVG_HALF} ${SVG_HALF * 2} ${SVG_HALF * 2}`,
		);
		svg.setAttribute('width', `${SVG_HALF * 2}`);
		svg.setAttribute('height', `${SVG_HALF * 2}`);
		const path = doc.createElementNS(ns, 'path');
		path.setAttribute('d', annularSectorPath(a1, a2, innerR, outerR));
		svg.appendChild(path);
		host.appendChild(svg);
	}

	private renderColorSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-color jot-palette-slot', off);
		btn.style.background = this.state.color;
		btn.setAttribute('aria-label', `Color (current: ${this.state.color})`);
		if (this.subArc === 'color') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('color'));
		host.appendChild(btn);
	}

	private renderToolSlot(host: HTMLElement, doc: Document, off: Offset) {
		const icon = TOOL_ICON[this.lastDrawingTool];
		const btn = this.makeItem(doc, 'jot-palette-tool jot-palette-slot', off);
		setIcon(btn, icon);
		btn.setAttribute('aria-label', `Tool (current: ${this.lastDrawingTool})`);
		if (this.state.tool === this.lastDrawingTool) btn.classList.add('is-active');
		if (this.subArc === 'tool') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('tool'));
		host.appendChild(btn);
	}

	private renderEraserSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-tool jot-palette-slot', off);
		setIcon(btn, 'eraser');
		btn.setAttribute('aria-label', 'Eraser');
		if (this.state.tool === 'eraser') btn.classList.add('is-active');
		btn.addEventListener('click', () => {
			this.state.tool = 'eraser';
			this.subArc = null;
			this.onChange(this.state);
			this.rerender();
		});
		host.appendChild(btn);
	}

	private renderWidthSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-width jot-palette-slot', off);
		btn.setAttribute('aria-label', `Width (current: ${this.state.width})`);
		const dot = doc.createElement('span');
		dot.className = 'jot-palette-width-dot';
		const px = Math.round(4 + (this.state.width / MAX_PALETTE_WIDTH) * 14);
		dot.style.width = `${px}px`;
		dot.style.height = `${px}px`;
		btn.appendChild(dot);
		if (this.subArc === 'width') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('width'));
		host.appendChild(btn);
	}

	private subArcItemCount(): number {
		if (this.subArc === 'color') return PALETTE_COLORS.length;
		if (this.subArc === 'tool') return DRAWING_TOOLS.length;
		if (this.subArc === 'width') return PALETTE_WIDTHS.length;
		return 0;
	}

	private renderSubColors(host: HTMLElement, doc: Document) {
		const n = PALETTE_COLORS.length;
		for (let i = 0; i < n; i++) {
			const color = PALETTE_COLORS[i];
			if (!color) continue;
			const off = this.itemOffset(i, n, SUB_ARC_RADIUS);
			const btn = this.makeItem(doc, 'jot-palette-color', off);
			btn.style.background = color;
			btn.setAttribute('aria-label', `Color ${color}`);
			btn.addEventListener('click', () => {
				this.state.color = color;
				this.subArc = null;
				this.onChange(this.state);
				this.rerender();
			});
			host.appendChild(btn);
		}
	}

	private renderSubTools(host: HTMLElement, doc: Document) {
		const n = DRAWING_TOOLS.length;
		for (let i = 0; i < n; i++) {
			const t = DRAWING_TOOLS[i];
			if (!t) continue;
			const off = this.itemOffset(i, n, SUB_ARC_RADIUS);
			const btn = this.makeItem(doc, 'jot-palette-tool', off);
			setIcon(btn, t.icon);
			btn.setAttribute('aria-label', t.label);
			btn.addEventListener('click', () => {
				this.state.tool = t.id;
				this.lastDrawingTool = t.id;
				this.subArc = null;
				this.onChange(this.state);
				this.rerender();
			});
			host.appendChild(btn);
		}
	}

	private renderSubWidths(host: HTMLElement, doc: Document) {
		const widths = PALETTE_WIDTHS;
		const n = widths.length;
		for (let i = 0; i < n; i++) {
			const w = widths[i];
			if (w === undefined) continue;
			const off = this.itemOffset(i, n, SUB_ARC_RADIUS);
			const btn = this.makeItem(doc, 'jot-palette-width', off);
			btn.setAttribute('aria-label', `Width ${w}`);
			const dot = doc.createElement('span');
			dot.className = 'jot-palette-width-dot';
			const px = Math.round(4 + (w / MAX_PALETTE_WIDTH) * 14);
			dot.style.width = `${px}px`;
			dot.style.height = `${px}px`;
			btn.appendChild(dot);
			btn.addEventListener('click', () => {
				this.state.width = w;
				this.subArc = null;
				this.onChange(this.state);
				this.rerender();
			});
			host.appendChild(btn);
		}
	}

	private makeItem(doc: Document, extraClass: string, off: Offset): HTMLButtonElement {
		const btn = doc.createElement('button');
		btn.className = `jot-palette-item ${extraClass}`;
		btn.style.setProperty('--ox', `${off.ox}px`);
		btn.style.setProperty('--oy', `${off.oy}px`);
		return btn;
	}

	private itemOffset(i: number, n: number, radius: number): Offset {
		// Each item gets ITEM_ANGULAR_DEG of arc. An n-item arc spans
		// (n-1) * ITEM_ANGULAR_DEG centered on the handedness-tilted axis.
		const step = (ITEM_ANGULAR_DEG * Math.PI) / 180;
		const center = arcCenterAngle(this.handedness, this.flipDown);
		const span = (n - 1) * step;
		const theta = n === 1 ? center : center - span / 2 + i * step;
		return {
			ox: Math.round(Math.cos(theta) * radius),
			oy: Math.round(Math.sin(theta) * radius),
		};
	}

	private bindOutsideClose(doc: Document) {
		const handler = (e: PointerEvent) => {
			if (!this.element) return;
			const target = e.target as Node | null;
			if (target && this.element.contains(target)) return;
			this.hide();
		};
		this.outsideHandler = handler;
		this.outsideDoc = doc;
		// Defer so the opening pointerdown (if any) doesn't immediately close us.
		window.setTimeout(() => {
			if (this.outsideHandler === handler) {
				doc.addEventListener('pointerdown', handler, true);
			}
		}, 0);
	}
}

interface Offset {
	ox: number;
	oy: number;
}
