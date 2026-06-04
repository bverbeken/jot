import { describe, expect, it } from 'vitest';
import type { Stroke } from './strokes';
import {
	INK_FORMAT_VERSION,
	buildInkPayload,
	inkPathFor,
	isSupportedVersion,
	migrateStroke,
	pageKey,
	parseInkText,
	pdfPathFromKey,
} from './ink-file';

const penStroke = (color = '#000'): Stroke => ({
	points: [{ x: 0.1, y: 0.2, pressure: 0.5 }],
	color,
	width: 0.005,
	tool: 'pen',
});

describe('inkPathFor', () => {
	it('appends .ink.json to the PDF path', () => {
		expect(inkPathFor('Folder/Notes.pdf')).toBe('Folder/Notes.pdf.ink.json');
	});
});

describe('pageKey and pdfPathFromKey', () => {
	it('builds a key from a pdf path and a page number', () => {
		expect(pageKey('a.pdf', 3)).toBe('a.pdf::3');
	});
	it('recovers the pdf path from a key', () => {
		expect(pdfPathFromKey('a.pdf::3')).toBe('a.pdf');
	});
	it('returns null for a key with no separator', () => {
		expect(pdfPathFromKey('no-separator')).toBeNull();
	});
	it('splits on the last separator so paths containing :: survive', () => {
		expect(pdfPathFromKey('a::b.pdf::7')).toBe('a::b.pdf');
	});
});

describe('parseInkText', () => {
	it('returns null for malformed JSON', () => {
		expect(parseInkText('not json')).toBeNull();
	});
	it('returns null for a non-object payload', () => {
		expect(parseInkText('42')).toBeNull();
	});
	it('returns null when the version field is missing', () => {
		expect(parseInkText(JSON.stringify({ pages: {} }))).toBeNull();
	});
	it('returns null when the pages field is missing or not an object', () => {
		expect(parseInkText(JSON.stringify({ version: 2 }))).toBeNull();
		expect(parseInkText(JSON.stringify({ version: 2, pages: 7 }))).toBeNull();
	});
	it('returns the parsed payload for a valid ink file', () => {
		const result = parseInkText(JSON.stringify({ version: 2, pages: { '1': [] } }));
		expect(result).toEqual({ version: 2, pages: { '1': [] } });
	});
});

describe('isSupportedVersion', () => {
	it('accepts the current format version', () => {
		expect(isSupportedVersion(INK_FORMAT_VERSION)).toBe(true);
	});
	it('accepts version 1 for backwards compatibility', () => {
		expect(isSupportedVersion(1)).toBe(true);
	});
	it('rejects an unknown future version', () => {
		expect(isSupportedVersion(99)).toBe(false);
	});
});

describe('migrateStroke', () => {
	it('assumes the pen tool when the field is missing on a v1 stroke', () => {
		const migrated = migrateStroke({
			points: [{ x: 0, y: 0, pressure: 0.5 }],
			color: '#abc',
			width: 0.01,
		});
		expect(migrated.tool).toBe('pen');
	});
	it('preserves an explicit tool', () => {
		const migrated = migrateStroke({ tool: 'highlighter' });
		expect(migrated.tool).toBe('highlighter');
	});
	it('keeps the original color, width, and points', () => {
		const migrated = migrateStroke({
			points: [{ x: 0.5, y: 0.5, pressure: 1 }],
			color: '#f00',
			width: 0.009,
			tool: 'pen',
		});
		expect(migrated.color).toBe('#f00');
		expect(migrated.width).toBe(0.009);
		expect(migrated.points).toEqual([{ x: 0.5, y: 0.5, pressure: 1 }]);
	});
});

describe('buildInkPayload', () => {
	const strokes = new Map<string, Stroke[]>();

	it('returns null when the PDF has no recorded strokes', () => {
		strokes.clear();
		expect(buildInkPayload('a.pdf', strokes)).toBeNull();
	});
	it('includes only pages whose key starts with the PDF prefix', () => {
		strokes.clear();
		strokes.set('a.pdf::1', [penStroke('#a')]);
		strokes.set('b.pdf::1', [penStroke('#b')]);
		const payload = buildInkPayload('a.pdf', strokes);
		expect(Object.keys(payload!.pages)).toEqual(['1']);
	});
	it('strips the PDF prefix from page keys in the output', () => {
		strokes.clear();
		strokes.set('a.pdf::5', [penStroke()]);
		const payload = buildInkPayload('a.pdf', strokes);
		expect(payload!.pages['5']).toBeDefined();
	});
	it('skips pages whose stroke array is empty', () => {
		strokes.clear();
		strokes.set('a.pdf::1', []);
		strokes.set('a.pdf::2', [penStroke()]);
		const payload = buildInkPayload('a.pdf', strokes);
		expect(Object.keys(payload!.pages)).toEqual(['2']);
	});
	it('writes the current format version', () => {
		strokes.clear();
		strokes.set('a.pdf::1', [penStroke()]);
		expect(buildInkPayload('a.pdf', strokes)!.version).toBe(INK_FORMAT_VERSION);
	});
});
