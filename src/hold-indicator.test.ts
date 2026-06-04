/* eslint-disable obsidianmd/prefer-active-doc */
import { describe, expect, it } from 'vitest';
import { createHoldIndicator } from './hold-indicator';

describe('createHoldIndicator', () => {
	it('uses the jot-hold-indicator class', () => {
		const el = createHoldIndicator(document, 100, 100, 300);
		expect(el.className).toBe('jot-hold-indicator');
	});

	it('positions the element at the given client coordinates', () => {
		const el = createHoldIndicator(document, 250, 175, 300);
		expect(el.style.left).toBe('250px');
		expect(el.style.top).toBe('175px');
	});

	it('exposes the duration through the --jot-hold-duration CSS variable', () => {
		const el = createHoldIndicator(document, 0, 0, 500);
		expect(el.style.getPropertyValue('--jot-hold-duration')).toBe('500ms');
	});

	it('contains an SVG with a single circle for the progress ring', () => {
		const el = createHoldIndicator(document, 0, 0, 300);
		const circles = el.querySelectorAll('svg circle');
		expect(circles).toHaveLength(1);
	});
});
