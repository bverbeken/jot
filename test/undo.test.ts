import { describe, expect, it } from 'vitest';
import type { Stroke } from '../src/strokes';
import { MAX_UNDO_DEPTH, UndoEntry, UndoHistory } from '../src/undo';

const stroke = (color = '#000'): Stroke => ({
	points: [{ x: 0, y: 0, pressure: 0.5 }],
	color,
	width: 0.01,
	tool: 'pen',
});

const entry = (pdfPath: string, key: string, strokes: Stroke[] = []): UndoEntry => ({
	pdfPath,
	key,
	prevStrokes: strokes,
});

describe('UndoHistory.push', () => {
	it('marks the path as undoable after the first push', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		expect(history.canUndo('a.pdf')).toBe(true);
	});
	it('clears the redo stack for that path on a new push', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		history.popUndo('a.pdf', () => []);
		expect(history.canRedo('a.pdf')).toBe(true);
		history.push(entry('a.pdf', 'a.pdf::1'));
		expect(history.canRedo('a.pdf')).toBe(false);
	});
	it('evicts the oldest entry once the depth limit is exceeded', () => {
		const history = new UndoHistory();
		const original = stroke('#aaa');
		history.push(entry('a.pdf', 'a.pdf::1', [original]));
		for (let i = 0; i < MAX_UNDO_DEPTH; i++) {
			history.push(entry('a.pdf', 'a.pdf::1', [stroke()]));
		}
		const lastPop = popAll(history, 'a.pdf');
		expect(lastPop[lastPop.length - 1]!.prevStrokes[0]!.color).not.toBe('#aaa');
	});
});

describe('UndoHistory.canUndo / canRedo', () => {
	it('returns false for unknown paths', () => {
		const history = new UndoHistory();
		expect(history.canUndo('missing.pdf')).toBe(false);
		expect(history.canRedo('missing.pdf')).toBe(false);
	});
});

describe('UndoHistory.popUndo', () => {
	it('returns the most recently pushed entry', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1', [stroke('#first')]));
		history.push(entry('a.pdf', 'a.pdf::1', [stroke('#second')]));
		const popped = history.popUndo('a.pdf', () => []);
		expect(popped?.prevStrokes[0]!.color).toBe('#second');
	});
	it('snapshots the current state into the redo stack', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1', [stroke('#prev')]));
		const current = [stroke('#current')];
		history.popUndo('a.pdf', () => current);
		const redone = history.popRedo('a.pdf', () => []);
		expect(redone?.prevStrokes[0]!.color).toBe('#current');
	});
	it('returns null when the undo stack is empty', () => {
		const history = new UndoHistory();
		expect(history.popUndo('a.pdf', () => [])).toBeNull();
	});
	it('decrements canUndo and increments canRedo on a successful pop', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		history.popUndo('a.pdf', () => []);
		expect(history.canUndo('a.pdf')).toBe(false);
		expect(history.canRedo('a.pdf')).toBe(true);
	});
});

describe('UndoHistory.popRedo', () => {
	it('returns null without changing state when the redo stack is empty', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		expect(history.popRedo('a.pdf', () => [])).toBeNull();
		expect(history.canUndo('a.pdf')).toBe(true);
	});
	it('returns the most recently undone entry and pushes the current state back to undo', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1', [stroke('#first')]));
		const undone = history.popUndo('a.pdf', () => [stroke('#current')]);
		expect(undone).not.toBeNull();
		const redone = history.popRedo('a.pdf', () => [stroke('#now')]);
		expect(redone?.prevStrokes[0]!.color).toBe('#current');
		expect(history.canUndo('a.pdf')).toBe(true);
	});
});

describe('UndoHistory.dropPath', () => {
	it('forgets every entry for the path on both stacks', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		history.popUndo('a.pdf', () => []);
		history.dropPath('a.pdf');
		expect(history.canUndo('a.pdf')).toBe(false);
		expect(history.canRedo('a.pdf')).toBe(false);
	});
	it('does not touch other paths', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1'));
		history.push(entry('b.pdf', 'b.pdf::1'));
		history.dropPath('a.pdf');
		expect(history.canUndo('b.pdf')).toBe(true);
	});
});

describe('UndoHistory across multiple PDFs', () => {
	it('keeps a separate stack per pdfPath', () => {
		const history = new UndoHistory();
		history.push(entry('a.pdf', 'a.pdf::1', [stroke('#a')]));
		history.push(entry('b.pdf', 'b.pdf::1', [stroke('#b')]));
		expect(history.popUndo('a.pdf', () => [])?.prevStrokes[0]!.color).toBe('#a');
		expect(history.popUndo('b.pdf', () => [])?.prevStrokes[0]!.color).toBe('#b');
	});
});

function popAll(history: UndoHistory, pdfPath: string): UndoEntry[] {
	const out: UndoEntry[] = [];
	while (history.canUndo(pdfPath)) {
		const popped = history.popUndo(pdfPath, () => []);
		if (popped) out.push(popped);
	}
	return out;
}
