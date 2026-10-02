/* eslint-disable obsidianmd/prefer-active-doc */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { OverlayManager } from '../src/overlay-manager';
import { StrokeStore } from '../src/stroke-store';

function pdfLeafWithPages(pageCount: number) {
	const containerEl = document.createElement('div');
	for (let n = 1; n <= pageCount; n++) {
		const page = document.createElement('div');
		page.className = 'page';
		page.setAttribute('data-page-number', String(n));
		containerEl.appendChild(page);
	}
	document.body.appendChild(containerEl);
	return { view: { getViewType: () => 'pdf', file: { path: 'doc.pdf' }, containerEl } };
}

function appWith(leaf: ReturnType<typeof pdfLeafWithPages>): App {
	return {
		workspace: {
			getMostRecentLeaf: () => leaf,
			iterateAllLeaves: (cb: (l: unknown) => void) => cb(leaf),
		},
	} as unknown as App;
}

beforeAll(() => {
	(window as { activeDocument?: Document }).activeDocument = document;
});

afterEach(() => {
	document.body.innerHTML = '';
});

describe('OverlayManager plugin reload', () => {
	it('removes its overlay canvases when detached', () => {
		const leaf = pdfLeafWithPages(2);
		const manager = new OverlayManager(appWith(leaf), new StrokeStore(), () => {});
		manager.attachToActivePdf();
		expect(leaf.view.containerEl.querySelectorAll('canvas.jot-overlay')).toHaveLength(2);

		manager.detachAll();

		expect(leaf.view.containerEl.querySelectorAll('canvas.jot-overlay')).toHaveLength(0);
	});

	// Overlays left behind by a previous plugin instance keep that instance's
	// pointer listeners — and with them its settings — until Obsidian restarts.
	it('lets a fresh instance wire every page after the previous one detached', () => {
		const leaf = pdfLeafWithPages(2);
		const first = new OverlayManager(appWith(leaf), new StrokeStore(), () => {});
		first.attachToActivePdf();
		first.detachAll();

		const wired: HTMLCanvasElement[] = [];
		const second = new OverlayManager(appWith(leaf), new StrokeStore(), (c) => wired.push(c));
		second.attachToActivePdf();

		expect(wired).toHaveLength(2);
		expect(leaf.view.containerEl.querySelectorAll('canvas.jot-overlay')).toHaveLength(2);
	});
});
