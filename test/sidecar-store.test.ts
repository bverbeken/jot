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

	it('remembers what it wrote so its own save is recognized', async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [
			{ points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' },
		]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(true);
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

describe('SidecarStore.isOwnSave', () => {
	const stroke = { points: [{ x: 0, y: 0, pressure: 0.5 }], color: '#000', width: 0.005, tool: 'pen' as const };

	const savedStore = async () => {
		const fs = makeFs();
		const strokes = new StrokeStore();
		strokes.setForKey('a.pdf::1', [stroke]);
		const store = new SidecarStore(fs.adapter, strokes);
		await store.save('a.pdf');
		return { fs, store };
	};

	it('returns false for a path it never wrote', async () => {
		const fs = makeFs({ 'a.pdf.jot.json': validPayload });
		const store = new SidecarStore(fs.adapter, new StrokeStore());
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(false);
	});

	it('keeps recognizing its own save however long the sync echo takes', async () => {
		vi.useFakeTimers();
		const { store } = await savedStore();
		vi.advanceTimersByTime(60_000);
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(true);
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(true);
		vi.useRealTimers();
	});

	it('returns false when another device changed the file right after our save', async () => {
		const { fs, store } = await savedStore();
		fs.files['a.pdf.jot.json'] = validPayload;
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(false);
	});

	it('forgets its write after a reload, so a later identical file still reloads', async () => {
		const { store } = await savedStore();
		await store.load('a.pdf');
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(false);
	});

	it('returns false when the file can no longer be read', async () => {
		const { fs, store } = await savedStore();
		vi.mocked(fs.adapter.read).mockRejectedValueOnce(new Error('gone'));
		expect(await store.isOwnSave('a.pdf.jot.json')).toBe(false);
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
