/* eslint-disable @typescript-eslint/unbound-method */
import type { DataAdapter } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOT_FORMAT_VERSION } from '../src/jot-file';
import { SidecarStore } from '../src/sidecar-store';
import { StrokeStore } from '../src/stroke-store';

interface FileSystem {
	files: Record<string, string>;
	adapter: DataAdapter;
}

const makeFs = (initial: Record<string, string> = {}): FileSystem => {
	const files: Record<string, string> = { ...initial };
	const adapter = {
		exists: vi.fn(async (path: string) => path in files),
		read: vi.fn(async (path: string) => files[path] ?? ''),
		write: vi.fn(async (path: string, data: string) => {
			files[path] = data;
		}),
		remove: vi.fn(async (path: string) => {
			delete files[path];
		}),
	} as unknown as DataAdapter;
	return { files, adapter };
};

const validPayload = JSON.stringify({
	version: JOT_FORMAT_VERSION,
	pages: { '1': [{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' }] },
});

describe('SidecarStore.load', () => {
	it('returns without populating strokes when the sidecar file does not exist', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		const store = new SidecarStore(fs.adapter, strokes);
		await store.load('a.pdf');
		expect(strokes.hasFor('a.pdf')).toBe(false);
	});

	it('clears any previously loaded strokes for the PDF on every call', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.load('a.pdf');
		expect(strokes.hasFor('a.pdf')).toBe(false);
	});

	it('populates strokes from a valid sidecar file', async () => {
		const fs = makeFs({ 'a.pdf.jot.json': validPayload });
		const strokes = new StrokeStore();
		const store = new SidecarStore(fs.adapter, strokes);
		await store.load('a.pdf');
		expect(strokes.forPage('a.pdf', 1)).toHaveLength(1);
	});

	it('silently skips malformed JSON', async () => {
		const fs = makeFs({ 'a.pdf.jot.json': 'not json at all' });
		const strokes = new StrokeStore();
		const store = new SidecarStore(fs.adapter, strokes);
		await store.load('a.pdf');
		expect(strokes.hasFor('a.pdf')).toBe(false);
	});

	it('warns and skips when the file version is unsupported', async () => {
		const fs = makeFs({
			'a.pdf.jot.json': JSON.stringify({ version: 99, pages: { '1': [] } }),
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const strokes = new StrokeStore();
		const store = new SidecarStore(fs.adapter, strokes);
		await store.load('a.pdf');
		expect(warn).toHaveBeenCalled();
		expect(strokes.hasFor('a.pdf')).toBe(false);
		warn.mockRestore();
	});
});

describe('SidecarStore.save', () => {
	it('writes a JSON payload at the .jot.json path when strokes are present', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		expect(fs.files['a.pdf.jot.json']).toBeDefined();
	});

	it('removes the sidecar file when there are no strokes left and the file exists', async () => {
		const fs = makeFs({ 'a.pdf.jot.json': validPayload });
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		await store.save('a.pdf');
		expect(fs.files['a.pdf.jot.json']).toBeUndefined();
	});

	it('does nothing when there are no strokes and no file exists', async () => {
		const fs = makeFs();
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		await store.save('a.pdf');
		expect(fs.adapter.remove).not.toHaveBeenCalled();
	});

	it('records the write path in the self-save tracker', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		expect(store.isOwnRecentSave('a.pdf.jot.json')).toBe(true);
	});
});

describe('SidecarStore.scheduleSave', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('debounces calls — only saves once after the quiet period', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		store.scheduleSave('a.pdf');
		store.scheduleSave('a.pdf');
		store.scheduleSave('a.pdf');
		await vi.advanceTimersByTimeAsync(250);
		expect(fs.adapter.write).toHaveBeenCalledTimes(1);
	});

	it('does not save before the debounce window elapses', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		store.scheduleSave('a.pdf');
		await vi.advanceTimersByTimeAsync(100);
		expect(fs.adapter.write).not.toHaveBeenCalled();
	});
});

describe('SidecarStore.isOwnRecentSave', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns false for an unknown path', () => {
		const fs = makeFs();
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		expect(store.isOwnRecentSave('unknown.jot.json')).toBe(false);
	});

	it('returns true for a path saved within the suppression window', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		expect(store.isOwnRecentSave('a.pdf.jot.json')).toBe(true);
	});

	it('returns false once the suppression window has elapsed', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		vi.advanceTimersByTime(1600);
		expect(store.isOwnRecentSave('a.pdf.jot.json')).toBe(false);
	});

	it('consumes the entry on the first true return so the next call is false', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		expect(store.isOwnRecentSave('a.pdf.jot.json')).toBe(true);
		expect(store.isOwnRecentSave('a.pdf.jot.json')).toBe(false);
	});
});

describe('SidecarStore.discard', () => {
	it('removes the sidecar file when it exists', async () => {
		const fs = makeFs({ 'a.pdf.jot.json': validPayload });
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		await store.discard('a.pdf');
		expect(fs.files['a.pdf.jot.json']).toBeUndefined();
	});

	it('is a no-op when the sidecar file does not exist', async () => {
		const fs = makeFs();
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		await store.discard('a.pdf');
		expect(fs.adapter.remove).not.toHaveBeenCalled();
	});
});

describe('SidecarStore.cancelAllPending', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('drops every pending scheduled save without firing them', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		store.scheduleSave('a.pdf');
		store.scheduleSave('b.pdf');
		store.cancelAllPending();
		await vi.advanceTimersByTimeAsync(1000);
		expect(fs.adapter.write).not.toHaveBeenCalled();
	});
});
