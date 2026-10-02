/* eslint-disable obsidianmd/prefer-active-doc */
import { afterEach, describe, expect, it } from 'vitest';


import { DEFAULT_TOOL_STATE, Handedness, Palette } from '../src/palette';

const hooks = {
	onUndo: () => {},
	onRedo: () => {},
	canUndo: () => false,
	canRedo: () => false,
};

function openPalette(handedness: Handedness): HTMLElement {
	const palette = new Palette({ ...DEFAULT_TOOL_STATE }, () => {}, hooks);
	// Middle of the default 1024×768 viewport: no flip-down and no edge clamping.
	palette.show(document.body, 512, 500, handedness);
	return document.body.querySelector('.jot-palette') as HTMLElement;
}

function mainSlotOffsetsX(el: HTMLElement): number[] {
	const items = el.querySelectorAll<HTMLElement>('.jot-palette-item:not(.jot-palette-close)');
	return Array.from(items, (item) => parseFloat(item.style.getPropertyValue('--ox')));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

afterEach(() => {
	document.body.innerHTML = '';
});

describe('Palette.show handedness', () => {
	it('fans a right-handed palette to the left of the press point', () => {
		expect(mean(mainSlotOffsetsX(openPalette('right')))).toBeLessThan(0);
	});

	it('fans a left-handed palette to the right of the press point', () => {
		expect(mean(mainSlotOffsetsX(openPalette('left')))).toBeGreaterThan(0);
	});

	it('honours a handedness change between two opens of the same palette', () => {
		const palette = new Palette({ ...DEFAULT_TOOL_STATE }, () => {}, hooks);
		palette.show(document.body, 512, 500, 'right');
		palette.show(document.body, 512, 500, 'left');
		const el = document.body.querySelector('.jot-palette') as HTMLElement;
		expect(document.body.querySelectorAll('.jot-palette')).toHaveLength(1);
		expect(mean(mainSlotOffsetsX(el))).toBeGreaterThan(0);
	});
});
