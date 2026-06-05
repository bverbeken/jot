import { setIcon } from 'obsidian';
import { ConfirmAnimator } from './confirm-animator';
import { DragHandler } from './drag-handler';
import { OutsideCloseListener } from './outside-close-listener';
import {
	BG_ANGULAR_PAD_DEG,
	MAIN_ARC_RADIUS,
	MAIN_ITEM_COUNT,
	MAIN_ITEM_STEP_RAD,
	Offset,
	RADIAL_MARGIN_PX,
	SUB_ARC_RADIUS,
	SUB_ITEM_STEP_RAD,
	SVG_HALF,
	arcCenterAngle,
	arcCenterlinePath,
	arcOrigin,
	mainSlotOffset,
	slotAngle,
	subSlotOffset,
} from './palette-geometry';

export type Tool = 'pen' | 'highlighter' | 'eraser';
export type Handedness = 'right' | 'left';

export interface ToolState {
	tool: Tool;
	color: string;
	width: number;
}

export interface ToolMemory {
	color: string;
	width: number;
}

export const DEFAULT_TOOL_STATE: ToolState = {
	tool: 'pen',
	color: '#000000',
	width: 0.0025,
};

export const DEFAULT_PEN_MEMORY: ToolMemory = {
	color: '#000000',
	width: 0.0025,
};

export const DEFAULT_HIGHLIGHTER_MEMORY: ToolMemory = {
	color: '#f5c518',
	width: 0.005,
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

const UNDO_SLOT_INDEX = 0;
const REDO_SLOT_INDEX = 1;
const TOOL_SLOT_INDEX = 2;
const WIDTH_SLOT_INDEX = 3;
const COLOR_SLOT_INDEX = 4;

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

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Palette {
	private element: HTMLElement | null = null;
	private outsideCloseListener: OutsideCloseListener;
	private confirmAnimator: ConfirmAnimator;
	private state: ToolState;
	private onChange: OnChange;
	private hooks: PaletteHooks;
	private flipDown = false;
	private subArc: SubArc = null;
	private handedness: Handedness = 'right';
	private penMemory: ToolMemory = { ...DEFAULT_PEN_MEMORY };
	private highlighterMemory: ToolMemory = { ...DEFAULT_HIGHLIGHTER_MEMORY };

	constructor(
		initial: ToolState,
		onChange: OnChange,
		hooks: PaletteHooks,
		memory?: { pen?: ToolMemory; highlighter?: ToolMemory },
	) {
		this.state = { ...initial };
		this.onChange = onChange;
		this.hooks = hooks;
		this.outsideCloseListener = new OutsideCloseListener(
			() => this.element,
			() => this.hide(),
		);
		this.confirmAnimator = new ConfirmAnimator(() => this.hide());
		if (memory?.pen) this.penMemory = { ...memory.pen };
		if (memory?.highlighter) this.highlighterMemory = { ...memory.highlighter };
		if (initial.tool === 'pen') {
			this.penMemory = { color: initial.color, width: initial.width };
		} else if (initial.tool === 'highlighter') {
			this.highlighterMemory = { color: initial.color, width: initial.width };
		}
	}

	getMemory(): { pen: ToolMemory; highlighter: ToolMemory } {
		return {
			pen: { ...this.penMemory },
			highlighter: { ...this.highlighterMemory },
		};
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
		this.handedness = handedness;
		this.flipDown = this.shouldFlipDown(clientY, doc);
		this.subArc = null;

		const el = doc.createElement('div');
		el.className = PALETTE_CLASS;
		el.style.left = `${clientX}px`;
		el.style.top = `${clientY}px`;
		this.renderItems(el, doc);
		parent.appendChild(el);

		this.element = el;
		this.bindDrag(el);
		this.outsideCloseListener.attach(doc);
	}

	hide() {
		if (!this.element) return;
		this.element.remove();
		this.element = null;
		this.subArc = null;
		this.outsideCloseListener.detach();
	}

	private shouldFlipDown(clientY: number, doc: Document): boolean {
		const win = doc.defaultView ?? window;
		const needed = SUB_ARC_RADIUS + RADIAL_MARGIN_PX;
		const fitsUp = clientY - needed >= RADIAL_MARGIN_PX;
		const fitsDown = clientY + needed <= win.innerHeight - RADIAL_MARGIN_PX;
		return !fitsUp && fitsDown;
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

	private origin(): Offset {
		return arcOrigin(this.handedness, this.flipDown);
	}

	private mainSlot(slot: number): Offset {
		return mainSlotOffset(slot, this.handedness, this.flipDown);
	}

	private subSlot(index: number, count: number, centerTheta: number): Offset {
		return subSlotOffset(index, count, centerTheta, this.handedness, this.flipDown);
	}

	private subArcCenter(): number {
		if (this.subArc === null) return 0;
		return slotAngle(SUB_SLOT_OF[this.subArc], this.handedness, this.flipDown);
	}

	private memoryFor(tool: Tool): ToolMemory | null {
		if (tool === 'pen') return this.penMemory;
		if (tool === 'highlighter') return this.highlighterMemory;
		return null;
	}

	private renderItems(host: HTMLElement, doc: Document) {
		this.renderDragArea(host, doc);
		this.renderBackground(host, doc);
		this.renderUndoSlot(host, doc, this.mainSlot(UNDO_SLOT_INDEX));
		this.renderRedoSlot(host, doc, this.mainSlot(REDO_SLOT_INDEX));
		this.renderToolSlot(host, doc, this.mainSlot(TOOL_SLOT_INDEX));
		this.renderWidthSlot(host, doc, this.mainSlot(WIDTH_SLOT_INDEX));
		this.renderColorSlot(host, doc, this.mainSlot(COLOR_SLOT_INDEX));
		this.renderActiveSubArc(host, doc);
		this.renderCloseSlot(host, doc);
	}

	private renderActiveSubArc(host: HTMLElement, doc: Document) {
		if (this.subArc === 'color') this.renderSubColors(host, doc);
		else if (this.subArc === 'tool') this.renderSubTools(host, doc);
		else if (this.subArc === 'width') this.renderSubWidths(host, doc);
	}

	private renderDragArea(host: HTMLElement, doc: Document) {
		const el = doc.createElement('div');
		el.className = 'jot-palette-drag-area';
		const origin = this.origin();
		el.style.setProperty('--ox', `${origin.ox}px`);
		el.style.setProperty('--oy', `${origin.oy}px`);
		host.appendChild(el);
	}

	private renderCloseSlot(host: HTMLElement, doc: Document) {
		const btn = this.makeItem(doc, 'jot-palette-close', this.origin());
		setIcon(btn, 'x');
		btn.setAttribute('aria-label', 'Close palette');
		btn.addEventListener('click', () => this.hide());
		host.appendChild(btn);
	}

	private renderUndoSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-tool', off);
		setIcon(btn, 'undo-2');
		btn.setAttribute('aria-label', 'Undo');
		if (!this.hooks.canUndo()) btn.classList.add('is-disabled');
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
		if (!this.hooks.canRedo()) btn.classList.add('is-disabled');
		btn.addEventListener('click', () => {
			if (!this.hooks.canRedo()) return;
			this.hooks.onRedo();
			this.rerender();
		});
		host.appendChild(btn);
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
		const btn = this.makeItem(doc, 'jot-palette-tool jot-palette-slot', off);
		setIcon(btn, TOOL_ICON[this.state.tool]);
		btn.setAttribute('aria-label', `Tool (current: ${this.state.tool})`);
		if (this.subArc === 'tool') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('tool'));
		host.appendChild(btn);
	}

	private renderWidthSlot(host: HTMLElement, doc: Document, off: Offset) {
		const btn = this.makeItem(doc, 'jot-palette-width jot-palette-slot', off);
		btn.setAttribute('aria-label', `Width (current: ${this.state.width})`);
		btn.appendChild(makeWidthDot(doc, this.state.width));
		if (this.subArc === 'width') btn.classList.add('is-open');
		btn.addEventListener('click', () => this.toggleSub('width'));
		host.appendChild(btn);
	}

	private renderBackground(host: HTMLElement, doc: Document) {
		const svg = doc.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('class', 'jot-palette-bg');
		svg.setAttribute('viewBox', `${-SVG_HALF} ${-SVG_HALF} ${SVG_HALF * 2} ${SVG_HALF * 2}`);
		svg.setAttribute('width', `${SVG_HALF * 2}`);
		svg.setAttribute('height', `${SVG_HALF * 2}`);
		const origin = this.origin();
		svg.style.setProperty('--arc-ox', `${origin.ox}px`);
		svg.style.setProperty('--arc-oy', `${origin.oy}px`);
		svg.appendChild(this.mainBandPath(doc));
		const subPath = this.subBandPath(doc);
		if (subPath) svg.appendChild(subPath);
		host.appendChild(svg);
	}

	private mainBandPath(doc: Document): SVGPathElement {
		const center = arcCenterAngle(this.handedness, this.flipDown);
		const pad = degToRad(BG_ANGULAR_PAD_DEG);
		const mainHalf = ((MAIN_ITEM_COUNT - 1) / 2) * MAIN_ITEM_STEP_RAD;
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute(
			'd',
			arcCenterlinePath(MAIN_ARC_RADIUS, center - mainHalf - pad, center + mainHalf + pad),
		);
		return path;
	}

	private subBandPath(doc: Document): SVGPathElement | null {
		if (this.subArc === null) return null;
		const pad = degToRad(BG_ANGULAR_PAD_DEG);
		const subCenter = this.subArcCenter();
		const subHalf = ((this.subArcItemCount() - 1) / 2) * SUB_ITEM_STEP_RAD;
		const path = doc.createElementNS(SVG_NS, 'path');
		path.setAttribute(
			'd',
			arcCenterlinePath(SUB_ARC_RADIUS, subCenter - subHalf - pad, subCenter + subHalf + pad),
		);
		return path;
	}

	private subArcItemCount(): number {
		if (this.subArc === 'color') return PALETTE_COLORS.length;
		if (this.subArc === 'tool') return TOOLS.length;
		if (this.subArc === 'width') return PALETTE_WIDTHS.length;
		return 0;
	}

	private renderSubColors(host: HTMLElement, doc: Document) {
		const subCenter = slotAngle(COLOR_SLOT_INDEX, this.handedness, this.flipDown);
		const colors = PALETTE_COLORS;
		colors.forEach((color, index) => {
			const off = this.subSlot(index, colors.length, subCenter);
			const btn = this.makeItem(doc, 'jot-palette-color', off);
			btn.style.background = color;
			btn.dataset.color = color;
			btn.setAttribute('aria-label', `Color ${color}`);
			btn.addEventListener('click', () => this.applyColor(color, btn));
			host.appendChild(btn);
		});
	}

	private applyColor(color: string, btn: HTMLElement) {
		this.state.color = color;
		const memory = this.memoryFor(this.state.tool);
		if (memory) memory.color = color;
		this.onChange(this.state);
		this.confirmAndDismiss(btn);
	}

	private renderSubTools(host: HTMLElement, doc: Document) {
		const subCenter = slotAngle(TOOL_SLOT_INDEX, this.handedness, this.flipDown);
		TOOLS.forEach((tool, index) => {
			const off = this.subSlot(index, TOOLS.length, subCenter);
			const btn = this.makeItem(doc, 'jot-palette-tool', off);
			setIcon(btn, tool.icon);
			btn.setAttribute('aria-label', tool.label);
			btn.addEventListener('click', () => this.applyTool(tool.id, btn));
			host.appendChild(btn);
		});
	}

	private applyTool(tool: Tool, btn: HTMLElement) {
		this.state.tool = tool;
		const memory = this.memoryFor(tool);
		if (memory) {
			this.state.color = memory.color;
			this.state.width = memory.width;
		}
		this.onChange(this.state);
		this.confirmAndDismiss(btn);
	}

	private renderSubWidths(host: HTMLElement, doc: Document) {
		const subCenter = slotAngle(WIDTH_SLOT_INDEX, this.handedness, this.flipDown);
		PALETTE_WIDTHS.forEach((width, index) => {
			const off = this.subSlot(index, PALETTE_WIDTHS.length, subCenter);
			const btn = this.makeItem(doc, 'jot-palette-width', off);
			btn.setAttribute('aria-label', `Width ${width}`);
			btn.appendChild(makeWidthDot(doc, width));
			btn.addEventListener('click', () => this.applyWidth(width, btn));
			host.appendChild(btn);
		});
	}

	private applyWidth(width: number, btn: HTMLElement) {
		this.state.width = width;
		const memory = this.memoryFor(this.state.tool);
		if (memory) memory.width = width;
		this.onChange(this.state);
		this.confirmAndDismiss(btn);
	}

	private confirmAndDismiss(btn: HTMLElement) {
		this.confirmAnimator.flashAndDismiss(btn);
	}

	private makeItem(doc: Document, extraClass: string, off: Offset): HTMLDivElement {
		const btn = doc.createElement('div');
		btn.setAttribute('role', 'button');
		btn.setAttribute('tabindex', '0');
		btn.className = `jot-palette-item ${extraClass}`;
		btn.style.setProperty('--ox', `${off.ox}px`);
		btn.style.setProperty('--oy', `${off.oy}px`);
		return btn;
	}

	private bindDrag(el: HTMLElement) {
		new DragHandler(el, { ignoreMouseInsideSelector: '.jot-palette-item' }).attach();
	}

}

function degToRad(deg: number): number {
	return (deg * Math.PI) / 180;
}

function makeWidthDot(doc: Document, width: number): HTMLSpanElement {
	const dot = doc.createElement('span');
	dot.className = 'jot-palette-width-dot';
	const px = Math.round(4 + (width / MAX_PALETTE_WIDTH) * 14);
	dot.style.width = `${px}px`;
	dot.style.height = `${px}px`;
	return dot;
}
