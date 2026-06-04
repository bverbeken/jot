import { describe, expect, it } from 'vitest';
import { isDarkColor } from '../src/palette-color';

describe('isDarkColor', () => {
	it('returns true for black', () => {
		expect(isDarkColor('#000000')).toBe(true);
	});
	it('returns false for white', () => {
		expect(isDarkColor('#ffffff')).toBe(false);
	});
	it('returns false for bright yellow', () => {
		expect(isDarkColor('#f5c518')).toBe(false);
	});
	it('returns true for deep blue', () => {
		expect(isDarkColor('#1f6cd3')).toBe(true);
	});
	it('accepts hex strings without a leading hash', () => {
		expect(isDarkColor('000000')).toBe(true);
	});
	it('returns false for hex strings of the wrong length', () => {
		expect(isDarkColor('#abc')).toBe(false);
	});
	it('returns false for non-hex characters', () => {
		expect(isDarkColor('#zzzzzz')).toBe(false);
	});
});
