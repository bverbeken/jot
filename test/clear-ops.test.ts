import { describe, expect, it } from 'vitest';
import {
	collectClearOperations,
	countStrokes,
	toUndoEntries,
} from '../src/clear-ops';
import type { Stroke } from '../src/stroke-math';

const stroke = (color = '#000'): Stroke => ({
	points: [{ x: 0, y: 0, pressure: 0.5 }],
	color,
	width: 0.005,
	tool: 'pen',
});

describe('collectClearOperations', () => {
	it('returns an empty list when no key starts with the PDF prefix', () => {
		const strokes = new Map<string, Stroke[]>();
		strokes.set('other.pdf::1', [stroke()]);
		expect(collectClearOperations('a.pdf', strokes)).toEqual([]);
	});

	it('returns one operation per page that has at least one stroke', () => {
		const strokes = new Map<string, Stroke[]>();
		strokes.set('a.pdf::1', [stroke('#1')]);
		strokes.set('a.pdf::2', [stroke('#2'), stroke('#3')]);
		const ops = collectClearOperations('a.pdf', strokes);
		expect(ops).toHaveLength(2);
	});

	it('skips pages whose stroke array is empty', () => {
		const strokes = new Map<string, Stroke[]>();
		strokes.set('a.pdf::1', []);
		strokes.set('a.pdf::2', [stroke()]);
		const ops = collectClearOperations('a.pdf', strokes);
		expect(ops.map((op) => op.key)).toEqual(['a.pdf::2']);
	});

	it('snapshots a copy of the strokes so later mutations do not leak in', () => {
		const strokes = new Map<string, Stroke[]>();
		const original = [stroke('#first')];
		strokes.set('a.pdf::1', original);
		const ops = collectClearOperations('a.pdf', strokes);
		original.push(stroke('#second'));
		expect(ops[0]!.prevStrokes).toHaveLength(1);
	});
});

describe('countStrokes', () => {
	it('sums the prevStrokes lengths across operations', () => {
		const ops = [
			{ key: 'a.pdf::1', prevStrokes: [stroke()] },
			{ key: 'a.pdf::2', prevStrokes: [stroke(), stroke()] },
		];
		expect(countStrokes(ops)).toBe(3);
	});

	it('returns zero for an empty list', () => {
		expect(countStrokes([])).toBe(0);
	});
});

describe('toUndoEntries', () => {
	it('attaches the pdfPath to every operation', () => {
		const ops = [{ key: 'a.pdf::1', prevStrokes: [stroke()] }];
		const entries = toUndoEntries('a.pdf', ops);
		expect(entries).toEqual([{ pdfPath: 'a.pdf', key: 'a.pdf::1', prevStrokes: ops[0]!.prevStrokes }]);
	});
});
