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
	color: '#000000',
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

// Radii of the two arcs (px). Chosen so the two stroked bands (50px thick
// each) leave a 6px visible gap between them: 110+25 = 135, 166-25 = 141.
const MAIN_ARC_RADIUS = 110;
const SUB_ARC_RADIUS = 166;
// Buffer to keep the outer arc off the screen edge before flipping.
const RADIAL_MARGIN_PX = 16;

// The geometric center of the arcs sits this far behind the press point
// (opposite the fan direction), pulling the nearest item closer to where
// the user pressed without shrinking the radius.
const ANCHOR_OFFSET_PX = 60;

// Each main-arc item occupies this much arc.
const ITEM_ANGULAR_DEG = 24;
const MAIN_ITEM_COUNT = 5;
const MAIN_ITEM_STEP_RAD = (ITEM_ANGULAR_DEG * Math.PI) / 180;
// Sub-arc step is chosen so adjacent sub items sit the same chord distance
// apart as adjacent main items — equal visual gap on both tiers despite the
// sub-arc sitting on a larger radius. Derived from the equal-chord condition
// 2·R_main·sin(step_main/2) = 2·R_sub·sin(step_sub/2).
const SUB_ITEM_STEP_RAD =
	2 *
	Math.asin(
		(MAIN_ARC_RADIUS / SUB_ARC_RADIUS) * Math.sin(MAIN_ITEM_STEP_RAD / 2),
	);

// Left-to-right slot indexes on the main arc.
const UNDO_SLOT_INDEX = 0;
const REDO_SLOT_INDEX = 1;
const TOOL_SLOT_INDEX = 2;
const WIDTH_SLOT_INDEX = 3;
const COLOR_SLOT_INDEX = 4;

// Tilt away from the pen hand: 20° off straight up.
const TILT_OFFSET_DEG = 20;

// Background bands — drawn as thick stroked arcs centered on the item
// radii, with rounded line caps for a pill-shaped end. Band thickness is
// set via stroke-width in CSS.
const BG_ANGULAR_PAD_DEG = 4;
const SVG_HALF = 280;

type OnChange = (state: ToolState) => void;
type SubArc = 'color' | 'tool' | 'width' | null;

export interface PaletteHooks {
	onUndo: () => void;
	onRedo: () => void;
	canUndo: () => boolean;
	canRedo: () => boolean;
}

const SUB_SLOT_OF: Record<Exclude<SubArc, null>, number> = {
	color: COLOR_SLOT_INDEX,
	tool: TOOL_SLOT_INDEX,
	width: WIDTH_SLOT_INDEX,
};

const TOOLS: { id: Tool; icon: string; label: string }[] = [
	{ id: 'pen', icon: 'pencil', label: 'Pen' },
	{ id: 'highlighter', icon: 'highlighter', label: 'Highlighter' },
	{ id: 'eraser', icon: 'eraser', label: 'Eraser' },
];

const TOOL_ICON: Record<Tool, string> = {
	pen: 'pencil',
	highlighter: 'highlighter',
	eraser: 'eraser',
};

// Center the fan opposite the pen hand. Straight up is 270° (3π/2), offset
// by TILT_OFFSET_DEG toward the side opposite the pen hand. Flipped down
// when there's no room above the press point.
function isDarkColor(hex: string): boolean {
	const h = hex.replace('#', '');
	if (h.length !== 6) return false;
	const r = parseInt(h.slice(0, 2), 16);
	const g = parseInt(h.slice(2, 4), 16);
	const b = parseInt(h.slice(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
	// Perceived luminance on 0..255 — below mid-light is "dark" for contrast.
	return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

function arcCenterAngle(handedness: Handedness, flipDown: boolean): number {
	const tilt = (TILT_OFFSET_DEG * Math.PI) / 180;
	const base = flipDown ? Math.PI / 2 : (3 * Math.PI) / 2;
	return handedness === 'right' ? base - tilt : base + tilt;
}

function arcCenterlinePath(r: number, a1: number, a2: number): string {
	const x1 = r * Math.cos(a1);
	const y1 = r * Math.sin(a1);
	const x2 = r * Math.cos(a2);
	const y2 = r * Math.sin(a2);
	const largeArc = Math.abs(a2 - a1) > Math.PI ? 1 : 0;
	return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

export class Palette {
	private element: HTMLElement | null = null;
	private outsideHandler: ((e: PointerEvent) => void) | null = null;
	private outsideDoc: Document | null = null;
	private state: ToolState;
	private onChange: OnChange;
	private hooks: PaletteHooks;
	private flipDown = false;
	private subArc: SubArc = null;
	private handedness: Handedness = 'right';

	constructor(initial: ToolState, onChange: OnChange, hooks: PaletteHooks) {
		this.state = { ...initial };
		this.onChange = onChange;
		this.hooks = hooks;
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
		this.bindDrag(el);
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

	// Where the arc circle's geometric center sits, relative to the press
	// point. Pushed behind the press point (opposite the fan direction) so
	// the nearest items end up close to where the user actually pressed.
	private arcOrigin(): Offset {
		const center = arcCenterAngle(this.handedness, this.flipDown);
		return {
			ox: -ANCHOR_OFFSET_PX * Math.cos(center),
			oy: -ANCHOR_OFFSET_PX * Math.sin(center),
		};
	}

	// Angular position (radians) of main-arc slot i.
	private slotAngle(i: number): number {
		const center = arcCenterAngle(this.handedness, this.flipDown);
		return center + (i - (MAIN_ITEM_COUNT - 1) / 2) * MAIN_ITEM_STEP_RAD;
	}

	private renderItems(host: HTMLElement, doc: Document) {
		this.renderDragArea(host, doc);
		this.renderBackground(host, doc);

		this.renderUndoSlot(host, doc, this.mainOffset(UNDO_SLOT_INDEX));
		this.renderRedoSlot(host, doc, this.mainOffset(REDO_SLOT_INDEX));
		this.renderToolSlot(host, doc, this.mainOffset(TOOL_SLOT_INDEX));
		this.renderWidthSlot(host, doc, this.mainOffset(WIDTH_SLOT_INDEX));
		this.renderColorSlot(host, doc, this.mainOffset(COLOR_SLOT_INDEX));

		if (this.subArc === 'color') this.renderSubColors(host, doc);
		else if (this.subArc === 'tool') this.renderSubTools(host, doc);
		else if (this.subArc === 'width') this.renderSubWidths(host, doc);

		this.renderCloseSlot(host, doc);
	}

	private renderCloseSlot(host: HTMLElement, doc: Document) {
		const btn = this.makeItem(doc, 'jot-palette-close', this.arcOrigin());
		setIcon(btn, 'x');
		btn.setAttribute('aria-label', 'Close palette');
		btn.addEventListener('click', () => this.hide());
		host.appendChild(btn);
	}

	// Transparent circular hit-target centered on the arc origin. It sits
	// behind the items and bands so it picks up taps in the empty space
	// inside the fan (between bands, around the close button) for drag.
	private renderDragArea(host: HTMLElement, doc: Document) {
		const el = doc.createElement('div');
		el.className = 'jot-palette-drag-area';
		const origin = this.arcOrigin();
		el.style.setProperty('--ox', `${origin.ox}px`);
		el.style.setProperty('--oy', `${origin.oy}px`);
		host.appendChild(el);
	}

	private renderUndoSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-tool', off);
		setIcon(btn, 'undo-2');
		btn.setAttribute('aria-label', 'Undo');
		const enabled = this.hooks.canUndo();
		if (!enabled) btn.classList.add('is-disabled');
		btn.addEventListener('click', () => {
			if (!this.hooks.canUndo()) return;
			this.hooks.onUndo();
			this.rerender();
		});
		host.appendChild(btn);
	}

	private renderRedoSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-tool', off);
		setIcon(btn, 'redo-2');
		btn.setAttribute('aria-label', 'Redo');
		const enabled = this.hooks.canRedo();
		if (!enabled) btn.classList.add('is-disabled');
		btn.addEventListener('click', () => {
			if (!this.hooks.canRedo()) return;
			this.hooks.onRedo();
			this.rerender();
		});
		host.appendChild(btn);
	}

	private renderBackground(host: HTMLElement, doc: Document) {
		const center = arcCenterAngle(this.handedness, this.flipDown);
		const pad = (BG_ANGULAR_PAD_DEG * Math.PI) / 180;

		const ns = 'http://www.w3.org/2000/svg';
		const svg = doc.createElementNS(ns, 'svg');
		svg.setAttribute('class', 'jot-palette-bg');
		svg.setAttribute(
			'viewBox',
			`${-SVG_HALF} ${-SVG_HALF} ${SVG_HALF * 2} ${SVG_HALF * 2}`,
		);
		svg.setAttribute('width', `${SVG_HALF * 2}`);
		svg.setAttribute('height', `${SVG_HALF * 2}`);
		const origin = this.arcOrigin();
		svg.style.setProperty('--arc-ox', `${origin.ox}px`);
		svg.style.setProperty('--arc-oy', `${origin.oy}px`);

		// Main band — a stroked arc at the main radius. The band's
		// thickness comes from stroke-width in CSS; rounded line caps
		// give the ends a pill shape.
		const mainHalf = ((MAIN_ITEM_COUNT - 1) / 2) * MAIN_ITEM_STEP_RAD;
		const mainPath = doc.createElementNS(ns, 'path');
		mainPath.setAttribute(
			'd',
			arcCenterlinePath(
				MAIN_ARC_RADIUS,
				center - mainHalf - pad,
				center + mainHalf + pad,
			),
		);
		svg.appendChild(mainPath);

		// Sub band — separate stroked arc at the sub radius, only when a
		// sub-arc is open.
		if (this.subArc !== null) {
			const slot = SUB_SLOT_OF[this.subArc];
			const subN = this.subArcItemCount();
			const subCenter = center + (slot - (MAIN_ITEM_COUNT - 1) / 2) * MAIN_ITEM_STEP_RAD;
			const subHalf = ((subN - 1) / 2) * SUB_ITEM_STEP_RAD;
			const subPath = doc.createElementNS(ns, 'path');
			subPath.setAttribute(
				'd',
				arcCenterlinePath(
					SUB_ARC_RADIUS,
					subCenter - subHalf - pad,
					subCenter + subHalf + pad,
				),
			);
			svg.appendChild(subPath);
		}

		host.appendChild(svg);
	}

	// Delegated drag handler on the palette container. Touch always drags
	// (even when starting on an item — the user can finger-pan from anywhere
	// inside the palette). Mouse drags only when starting outside an item,
	// so mouse clicks on buttons keep working. Pen is excluded — it's the
	// drawing instrument.
	private bindDrag(el: HTMLElement) {
		let dragging = false;
		let activeId: number | null = null;
		let startClientX = 0;
		let startClientY = 0;
		let startLeft = 0;
		let startTop = 0;

		el.addEventListener(
			'pointerdown',
			(e) => {
				if (e.pointerType === 'pen') return;
				if (e.pointerType === 'mouse') {
					const target = e.target as Element | null;
					if (target?.closest('.jot-palette-item')) return;
				}
				dragging = true;
				activeId = e.pointerId;
				startClientX = e.clientX;
				startClientY = e.clientY;
				startLeft = parseFloat(el.style.left) || 0;
				startTop = parseFloat(el.style.top) || 0;
				el.setPointerCapture(e.pointerId);
				e.preventDefault();
				e.stopPropagation();
			},
			true,
		);

		el.addEventListener(
			'pointermove',
			(e) => {
				if (!dragging || e.pointerId !== activeId) return;
				const dx = e.clientX - startClientX;
				const dy = e.clientY - startClientY;
				el.style.left = `${startLeft + dx}px`;
				el.style.top = `${startTop + dy}px`;
				e.preventDefault();
			},
			true,
		);

		const endDrag = (e: PointerEvent) => {
			if (!dragging || e.pointerId !== activeId) return;
			dragging = false;
			activeId = null;
			try { el.releasePointerCapture(e.pointerId); } catch {
				// already released
			}
		};
		el.addEventListener('pointerup', endDrag, true);
		el.addEventListener('pointercancel', endDrag, true);
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
		const icon = TOOL_ICON[this.state.tool];
		const btn = this.makeItem(doc, 'jot-palette-tool jot-palette-slot', off);
		setIcon(btn, icon);
		btn.setAttribute('aria-label', `Tool (current: ${this.state.tool})`);
		if (this.subArc === 'tool') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('tool'));
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
		if (this.subArc === 'tool') return TOOLS.length;
		if (this.subArc === 'width') return PALETTE_WIDTHS.length;
		return 0;
	}

	private renderSubColors(host: HTMLElement, doc: Document) {
		const n = PALETTE_COLORS.length;
		const subCenter = this.slotAngle(COLOR_SLOT_INDEX);
		for (let i = 0; i < n; i++) {
			const color = PALETTE_COLORS[i];
			if (!color) continue;
			const off = this.subOffset(i, n, subCenter);
			const btn = this.makeItem(doc, 'jot-palette-color', off);
			btn.style.background = color;
			btn.dataset.color = color;
			btn.setAttribute('aria-label', `Color ${color}`);
			btn.addEventListener('click', () => {
				this.state.color = color;
				this.onChange(this.state);
				this.confirmAndDismiss(btn);
			});
			host.appendChild(btn);
		}
	}

	private renderSubTools(host: HTMLElement, doc: Document) {
		const n = TOOLS.length;
		const subCenter = this.slotAngle(TOOL_SLOT_INDEX);
		for (let i = 0; i < n; i++) {
			const t = TOOLS[i];
			if (!t) continue;
			const off = this.subOffset(i, n, subCenter);
			const btn = this.makeItem(doc, 'jot-palette-tool', off);
			setIcon(btn, t.icon);
			btn.setAttribute('aria-label', t.label);
			btn.addEventListener('click', () => {
				this.state.tool = t.id;
				this.onChange(this.state);
				this.confirmAndDismiss(btn);
			});
			host.appendChild(btn);
		}
	}

	private renderSubWidths(host: HTMLElement, doc: Document) {
		const widths = PALETTE_WIDTHS;
		const n = widths.length;
		const subCenter = this.slotAngle(WIDTH_SLOT_INDEX);
		for (let i = 0; i < n; i++) {
			const w = widths[i];
			if (w === undefined) continue;
			const off = this.subOffset(i, n, subCenter);
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
				this.onChange(this.state);
				this.confirmAndDismiss(btn);
			});
			host.appendChild(btn);
		}
	}

	// Flash a check inside the tapped slot, then close the palette.
	// Respects prefers-reduced-motion (skips the scale-in, still closes).
	// Color swatches don't get the green fill — just the check, so the user
	// can still see which color they picked. Check color is chosen for
	// contrast against the swatch.
	private confirmAndDismiss(btn: HTMLElement) {
		const doc = btn.ownerDocument;
		const win = doc.defaultView ?? window;
		const reducedMotion = win.matchMedia(
			'(prefers-reduced-motion: reduce)',
		).matches;
		const check = doc.createElement('span');
		check.className = 'jot-palette-confirm';
		setIcon(check, 'check');
		const swatchColor = btn.dataset.color;
		if (swatchColor) {
			check.classList.add('on-swatch');
			check.style.color = isDarkColor(swatchColor) ? '#fff' : '#000';
		}
		btn.appendChild(check);
		win.requestAnimationFrame(() => check.classList.add('is-visible'));
		win.setTimeout(() => this.hide(), reducedMotion ? 80 : 280);
	}

	private makeItem(doc: Document, extraClass: string, off: Offset): HTMLDivElement {
		// Plain <div role="button"> rather than <button>: iOS Safari keeps
		// applying min-height and padding to <button> even after `all: unset`
		// and the explicit webkit resets, so the color/width swatches still
		// rendered as ovals on iPad. A div has no native styling baggage.
		const btn = doc.createElement('div');
		btn.setAttribute('role', 'button');
		btn.setAttribute('tabindex', '0');
		btn.className = `jot-palette-item ${extraClass}`;
		btn.style.setProperty('--ox', `${off.ox}px`);
		btn.style.setProperty('--oy', `${off.oy}px`);
		return btn;
	}

	// Position of main-arc slot i, relative to the press point.
	private mainOffset(i: number): Offset {
		const origin = this.arcOrigin();
		const theta = this.slotAngle(i);
		return {
			ox: Math.round(origin.ox + MAIN_ARC_RADIUS * Math.cos(theta)),
			oy: Math.round(origin.oy + MAIN_ARC_RADIUS * Math.sin(theta)),
		};
	}

	// Position of sub-arc item i (of n), centered on a given angle, relative
	// to the press point. Sub-arc step is the equal-chord match to the main
	// arc so adjacent items have the same visual gap on both tiers.
	private subOffset(i: number, n: number, centerTheta: number): Offset {
		const origin = this.arcOrigin();
		const span = (n - 1) * SUB_ITEM_STEP_RAD;
		const theta =
			n === 1 ? centerTheta : centerTheta - span / 2 + i * SUB_ITEM_STEP_RAD;
		return {
			ox: Math.round(origin.ox + SUB_ARC_RADIUS * Math.cos(theta)),
			oy: Math.round(origin.oy + SUB_ARC_RADIUS * Math.sin(theta)),
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
