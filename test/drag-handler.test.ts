/* eslint-disable obsidianmd/prefer-active-doc */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DragHandler } from '../src/drag-handler';

interface PointerEventOptions {
	pointerId?: number;
	pointerType?: 'mouse' | 'pen' | 'touch';
	clientX?: number;
	clientY?: number;
	target?: EventTarget;
}

const dispatch = (
	element: HTMLElement,
	type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
	options: PointerEventOptions = {},
): void => {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.assign(event, {
		pointerId: options.pointerId ?? 1,
		pointerType: options.pointerType ?? 'mouse',
		clientX: options.clientX ?? 0,
		clientY: options.clientY ?? 0,
	});
	if (options.target) {
		Object.defineProperty(event, 'target', { value: options.target, configurable: true });
	}
	element.dispatchEvent(event);
};

const makeElement = (left = '100px', top = '200px'): HTMLElement => {
	const el = document.createElement('div');
	el.style.left = left;
	el.style.top = top;
	document.body.appendChild(el);
	Object.assign(el, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
	return el;
};

describe('DragHandler', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('starts a drag on a touch pointerdown', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'touch', clientX: 50, clientY: 60 });
		dispatch(el, 'pointermove', { pointerType: 'touch', clientX: 70, clientY: 90 });
		expect(el.style.left).toBe('120px');
		expect(el.style.top).toBe('230px');
	});

	it('starts a drag on a mouse pointerdown by default', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
		dispatch(el, 'pointermove', { pointerType: 'mouse', clientX: 25, clientY: -10 });
		expect(el.style.left).toBe('125px');
		expect(el.style.top).toBe('190px');
	});

	it('ignores pen pointerdowns so the pen stays reserved for drawing', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'pen', clientX: 0, clientY: 0 });
		dispatch(el, 'pointermove', { pointerType: 'pen', clientX: 50, clientY: 50 });
		expect(el.style.left).toBe('100px');
		expect(el.style.top).toBe('200px');
	});

	it('ignores mouse pointerdowns that originate inside the configured selector', () => {
		const el = makeElement();
		const button = document.createElement('button');
		button.className = 'jot-palette-item';
		el.appendChild(button);
		new DragHandler(el, { ignoreMouseInsideSelector: '.jot-palette-item' }).attach();
		dispatch(el, 'pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0, target: button });
		dispatch(el, 'pointermove', { pointerType: 'mouse', clientX: 30, clientY: 30 });
		expect(el.style.left).toBe('100px');
		expect(el.style.top).toBe('200px');
	});

	it('still drags on a touch pointerdown that originates inside the configured selector', () => {
		const el = makeElement();
		const button = document.createElement('button');
		button.className = 'jot-palette-item';
		el.appendChild(button);
		new DragHandler(el, { ignoreMouseInsideSelector: '.jot-palette-item' }).attach();
		dispatch(el, 'pointerdown', { pointerType: 'touch', clientX: 0, clientY: 0, target: button });
		dispatch(el, 'pointermove', { pointerType: 'touch', clientX: 10, clientY: 20 });
		expect(el.style.left).toBe('110px');
		expect(el.style.top).toBe('220px');
	});

	it('captures the pointer when a drag starts and releases it on pointerup', () => {
		const el = makeElement();
		const setCapture = vi.fn();
		const releaseCapture = vi.fn();
		Object.assign(el, { setPointerCapture: setCapture, releasePointerCapture: releaseCapture });
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'mouse', pointerId: 7, clientX: 0, clientY: 0 });
		expect(setCapture).toHaveBeenCalledWith(7);
		dispatch(el, 'pointerup', { pointerType: 'mouse', pointerId: 7 });
		expect(releaseCapture).toHaveBeenCalledWith(7);
	});

	it('stops responding to movement after pointerup', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'mouse', clientX: 0, clientY: 0 });
		dispatch(el, 'pointermove', { pointerType: 'mouse', clientX: 30, clientY: 30 });
		dispatch(el, 'pointerup', { pointerType: 'mouse' });
		dispatch(el, 'pointermove', { pointerType: 'mouse', clientX: 200, clientY: 200 });
		expect(el.style.left).toBe('130px');
		expect(el.style.top).toBe('230px');
	});

	it('stops responding to movement after pointercancel', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'touch', clientX: 0, clientY: 0 });
		dispatch(el, 'pointermove', { pointerType: 'touch', clientX: 10, clientY: 10 });
		dispatch(el, 'pointercancel', { pointerType: 'touch' });
		dispatch(el, 'pointermove', { pointerType: 'touch', clientX: 200, clientY: 200 });
		expect(el.style.left).toBe('110px');
		expect(el.style.top).toBe('210px');
	});

	it('ignores pointermove events for a different pointerId mid-drag', () => {
		const el = makeElement();
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0 });
		dispatch(el, 'pointermove', { pointerType: 'touch', pointerId: 2, clientX: 99, clientY: 99 });
		expect(el.style.left).toBe('100px');
		expect(el.style.top).toBe('200px');
	});

	it('handles a left/top that was not previously set, treating them as 0', () => {
		const el = document.createElement('div');
		document.body.appendChild(el);
		Object.assign(el, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
		new DragHandler(el).attach();
		dispatch(el, 'pointerdown', { pointerType: 'mouse', clientX: 100, clientY: 100 });
		dispatch(el, 'pointermove', { pointerType: 'mouse', clientX: 150, clientY: 130 });
		expect(el.style.left).toBe('50px');
		expect(el.style.top).toBe('30px');
	});
});
