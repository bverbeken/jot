import { describe, expect, it } from 'vitest';
import { StrokeStore } from '../src/stroke-store';
import type { Stroke } from '../src/strokes';

const pen = (color = '#000'): Stroke => ({
	points: [{ x: 0, y: 0, pressure: 0.5 }],
	color,
	width: 0.005,
	tool: 'pen',
});

describe('StrokeStore.forPage', () => {
	it('returns an empty array for a page with no recorded strokes', () => {
		const store = new StrokeStore();
		expect(store.forPage('a.pdf', 1)).toEqual([]);
	});

	it('returns the strokes previously set for that page', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen('#1')]);
		expect(store.forPage('a.pdf', 1)).toEqual([pen('#1')]);
	});
});

describe('StrokeStore.appendToKey', () => {
	it('adds the stroke to the existing list for the key', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen('#first')]);
		store.appendToKey('a.pdf::1', pen('#second'));
		expect(store.forKey('a.pdf::1')).toHaveLength(2);
	});

	it('creates a new list when the key was previously empty', () => {
		const store = new StrokeStore();
		store.appendToKey('a.pdf::1', pen());
		expect(store.forKey('a.pdf::1')).toHaveLength(1);
	});
});

describe('StrokeStore.hasFor', () => {
	it('returns true when at least one page of the PDF has strokes', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen()]);
		expect(store.hasFor('a.pdf')).toBe(true);
	});

	it('returns false when every page of the PDF is empty', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', []);
		expect(store.hasFor('a.pdf')).toBe(false);
	});

	it('returns false for a PDF with no recorded pages', () => {
		const store = new StrokeStore();
		store.setForKey('other.pdf::1', [pen()]);
		expect(store.hasFor('a.pdf')).toBe(false);
	});
});

describe('StrokeStore.clearFor', () => {
	it('removes every page belonging to the PDF', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen()]);
		store.setForKey('a.pdf::2', [pen()]);
		store.clearFor('a.pdf');
		expect(store.hasFor('a.pdf')).toBe(false);
	});

	it('leaves other PDFs untouched', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen()]);
		store.setForKey('b.pdf::1', [pen()]);
		store.clearFor('a.pdf');
		expect(store.hasFor('b.pdf')).toBe(true);
	});
});

describe('StrokeStore.buildPayload', () => {
	it('returns a payload structured by page number', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::3', [pen()]);
		const payload = store.buildPayload('a.pdf');
		expect(payload?.pages['3']).toBeDefined();
	});

	it('returns null when the PDF has no strokes', () => {
		const store = new StrokeStore();
		expect(store.buildPayload('a.pdf')).toBeNull();
	});
});

describe('StrokeStore.populateFromPayload', () => {
	it('keys each page by pdf path + page number', () => {
		const store = new StrokeStore();
		store.populateFromPayload('a.pdf', { '2': [pen('#x')] });
		expect(store.forKey('a.pdf::2')).toHaveLength(1);
	});

	it('runs each stroke through migrateStroke so v1 entries default to pen', () => {
		const store = new StrokeStore();
		store.populateFromPayload('a.pdf', {
			'1': [{ points: [], color: '#000', width: 0.01 } as unknown as Stroke],
		});
		expect(store.forKey('a.pdf::1')[0]!.tool).toBe('pen');
	});

	it('skips pages whose number cannot be parsed', () => {
		const store = new StrokeStore();
		store.populateFromPayload('a.pdf', { 'not-a-number': [pen()] });
		expect(store.hasFor('a.pdf')).toBe(false);
	});
});

describe('StrokeStore.keysForPage', () => {
	it('returns only keys that belong to the requested PDF', () => {
		const store = new StrokeStore();
		store.setForKey('a.pdf::1', [pen()]);
		store.setForKey('b.pdf::1', [pen()]);
		expect(store.keysForPage('a.pdf')).toEqual(['a.pdf::1']);
	});
});
