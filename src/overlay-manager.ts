import { App, TFile, WorkspaceLeaf } from 'obsidian';
import { pageKey } from './jot-file';
import { drawStroke } from './stroke-render';
import type { StrokeStore } from './stroke-store';

const OVERLAY_CLASS = 'jot-overlay';
const PAGE_ANCHOR_CLASS = 'jot-page-anchor';
const PASSTHROUGH_CLASS = 'jot-passthrough';
const PAGE_OBSERVED_ATTR = 'data-jot-observed';

export const OVERLAY_KEY_ATTR = 'data-jot-key';

export class OverlayManager {
	private containerObservers = new Map<WorkspaceLeaf, MutationObserver>();

	constructor(
		private app: App,
		private strokes: StrokeStore,
		private wireOverlay: (canvas: HTMLCanvasElement) => void,
	) {}

	attachToActivePdf(): void {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return;
		const filePath = this.filePathForLeaf(leaf);
		if (!filePath) return;
		const container = leaf.view.containerEl;

		this.upgradePages(container, filePath);
		if (this.containerObservers.has(leaf)) return;
		const observer = new MutationObserver(() => {
			const currentPath = this.filePathForLeaf(leaf);
			if (!currentPath) return;
			this.upgradePages(container, currentPath);
		});
		observer.observe(container, { childList: true, subtree: true });
		this.containerObservers.set(leaf, observer);
	}

	pruneClosedObservers(): void {
		if (this.containerObservers.size === 0) return;
		const live = new Set<WorkspaceLeaf>();
		this.app.workspace.iterateAllLeaves((leaf) => live.add(leaf));
		for (const [leaf, observer] of this.containerObservers) {
			if (!live.has(leaf)) {
				observer.disconnect();
				this.containerObservers.delete(leaf);
			}
		}
	}

	disconnectAll(): void {
		this.containerObservers.forEach((observer) => observer.disconnect());
		this.containerObservers.clear();
	}

	redrawPage(canvas: HTMLCanvasElement): void {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return;
		for (const stroke of this.strokes.forKey(key)) {
			drawStroke(ctx, stroke, { width: canvas.width, height: canvas.height });
		}
	}

	redrawOverlaysForActivePdf(): void {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return;
		this.canvasesIn(leaf).forEach((canvas) => this.redrawPage(canvas));
	}

	redrawOverlaysForPdf(pdfPath: string): void {
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (this.filePathForLeaf(leaf) !== pdfPath) return;
			this.canvasesIn(leaf).forEach((canvas) => this.redrawPage(canvas));
		});
	}

	overlayForKey(key: string): HTMLCanvasElement | null {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return null;
		const escaped = key.replace(/["\\]/g, '\\$&');
		return leaf.view.containerEl.querySelector<HTMLCanvasElement>(
			`canvas.${OVERLAY_CLASS}[${OVERLAY_KEY_ATTR}="${escaped}"]`,
		);
	}

	getActivePdfLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return null;
		const viewType = leaf.view.getViewType?.();
		if (viewType !== 'pdf') return null;
		return leaf;
	}

	getActivePdfFilePath(): string | null {
		const leaf = this.getActivePdfLeaf();
		return leaf ? this.filePathForLeaf(leaf) : null;
	}

	private filePathForLeaf(leaf: WorkspaceLeaf): string | null {
		const file = (leaf.view as { file?: TFile }).file;
		return file?.path ?? null;
	}

	private canvasesIn(leaf: WorkspaceLeaf): NodeListOf<HTMLCanvasElement> {
		return leaf.view.containerEl.querySelectorAll<HTMLCanvasElement>(
			`canvas.${OVERLAY_CLASS}`,
		);
	}

	private upgradePages(container: HTMLElement, filePath: string): void {
		container
			.querySelectorAll<HTMLElement>('.page')
			.forEach((page) => this.ensureOverlayOnPage(page, filePath));
	}

	private ensureOverlayOnPage(page: HTMLElement, filePath: string): void {
		const pageNumberAttr = page.getAttribute('data-page-number');
		const pageNumber = pageNumberAttr ? parseInt(pageNumberAttr, 10) : NaN;
		if (Number.isNaN(pageNumber)) return;
		const key = pageKey(filePath, pageNumber);

		const existing = page.querySelector<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`);
		if (existing) {
			if (existing.getAttribute(OVERLAY_KEY_ATTR) === key) {
				this.sizeOverlayToPage(existing, page);
				this.redrawPage(existing);
				return;
			}
			existing.remove();
		}

		page.classList.add(PAGE_ANCHOR_CLASS);
		const overlay = activeDocument.createElement('canvas');
		overlay.className = OVERLAY_CLASS;
		overlay.setAttribute(OVERLAY_KEY_ATTR, key);
		this.sizeOverlayToPage(overlay, page);
		page.appendChild(overlay);
		this.disableTextLayerInteraction(page);
		this.wireOverlay(overlay);
		this.redrawPage(overlay);

		if (page.getAttribute(PAGE_OBSERVED_ATTR) === '1') return;
		page.setAttribute(PAGE_OBSERVED_ATTR, '1');

		const findOverlay = () =>
			page.querySelector<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`);

		new MutationObserver(() => {
			const current = findOverlay();
			if (!current) return;
			this.disableTextLayerInteraction(page);
			if (!page.contains(current)) {
				this.sizeOverlayToPage(current, page);
				page.appendChild(current);
				this.redrawPage(current);
			}
		}).observe(page, { childList: true });

		new ResizeObserver(() => {
			const current = findOverlay();
			if (!current) return;
			this.sizeOverlayToPage(current, page);
			this.redrawPage(current);
		}).observe(page);
	}

	private sizeOverlayToPage(overlay: HTMLCanvasElement, page: HTMLElement): void {
		const rect = page.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const targetWidth = Math.round(rect.width);
		const targetHeight = Math.round(rect.height);
		if (overlay.width !== targetWidth) overlay.width = targetWidth;
		if (overlay.height !== targetHeight) overlay.height = targetHeight;
		overlay.setCssStyles({
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		});
	}

	private disableTextLayerInteraction(page: HTMLElement): void {
		page.querySelector<HTMLElement>('.textLayer')?.classList.add(PASSTHROUGH_CLASS);
		page.querySelector<HTMLElement>('.annotationLayer')?.classList.add(PASSTHROUGH_CLASS);
	}
}
