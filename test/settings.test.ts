import { describe, expect, it } from 'vitest';
import { colorKey, parseColorKey } from '../src/settings-keys';

describe('colorKey / parseColorKey', () => {
	it('round-trips integer indices', () => {
		for (let i = 0; i < 7; i++) {
			expect(parseColorKey(colorKey(i))).toBe(i);
		}
	});

	it('parses a well-formed key', () => {
		expect(parseColorKey('colors.0')).toBe(0);
		expect(parseColorKey('colors.6')).toBe(6);
		expect(parseColorKey('colors.42')).toBe(42);
	});

	it('returns null for keys without the prefix', () => {
		expect(parseColorKey('handedness')).toBeNull();
		expect(parseColorKey('color.0')).toBeNull();
		expect(parseColorKey('')).toBeNull();
	});

	it('returns null for the bare prefix', () => {
		expect(parseColorKey('colors.')).toBeNull();
	});

	it('returns null when the suffix is not a non-negative integer', () => {
		expect(parseColorKey('colors.abc')).toBeNull();
		expect(parseColorKey('colors.-1')).toBeNull();
		expect(parseColorKey('colors.1.5')).toBeNull();
		expect(parseColorKey('colors.1e2')).toBeNull();
		expect(parseColorKey('colors. 1')).toBeNull();
		expect(parseColorKey('colors.1 ')).toBeNull();
	});

	it('does not match keys that merely contain the prefix', () => {
		expect(parseColorKey('xcolors.0')).toBeNull();
	});
});
