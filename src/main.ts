import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';

const PLUGIN_LOG = '[obsidian-ink]';
const OVERLAY_CLASS = 'obsidian-ink-overlay';

interface Point {
	x: number;
	y: number;
}

export default class ObsidianInkPlugin extends Plugin {
	private observers: MutationObserver[] = [];

	async onload() {
		console.log(`${PLUGIN_LOG} onload`);

		this.addRibbonIcon('pencil', 'Obsidian Ink: probe active PDF view', () => {
			this.probeActivePdfView();
		});

		this.addCommand({
			id: 'probe-pdf-view',
			name: 'Probe active PDF view (log DOM structure)',
			callback: () => this.probeActivePdfView(),
		});

		this.addCommand({
			id: 'attach-overlay-to-active-pdf',
			name: 'Attach ink overlay to active PDF view',
			callback: () => this.attachOverlayToActivePdfView(),
		});

		this.registerEvent(
			this.app.workspace.on('file-open', (file: TFile | null) => {
				if (file?.extension === 'pdf') {
					console.log(`${PLUGIN_LOG} file-open pdf: ${file.path}`);
					setTimeout(() => this.attachOverlayToActivePdfView(), 300);
				}
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.attachOverlayToActivePdfView();
			}),
		);
	}

	onunload() {
		this.observers.forEach((o) => o.disconnect());
		this.observers = [];
	}

	private getActivePdfLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return null;
		const viewType = leaf.view.getViewType?.();
		if (viewType !== 'pdf') return null;
		return leaf;
	}

	private probeActivePdfView() {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) {
			new Notice('No active PDF view. Open a PDF first.');
			console.log(`${PLUGIN_LOG} probe: no active PDF view`);
			return;
		}
		const container = leaf.view.containerEl;
		console.log(`${PLUGIN_LOG} probe: view type = ${leaf.view.getViewType()}`);
		console.log(`${PLUGIN_LOG} probe: containerEl =`, container);

		const candidateSelectors = [
			'.pdf-viewer',
			'.pdf-container',
			'.pdf-viewer-container',
			'.pdfViewer',
			'.page',
			'canvas',
		];
		for (const sel of candidateSelectors) {
			const matches = container.querySelectorAll(sel);
			console.log(`${PLUGIN_LOG} probe: "${sel}" matched ${matches.length}`);
			if (matches.length > 0 && matches.length < 5) {
				matches.forEach((el, i) => {
					console.log(`${PLUGIN_LOG}   [${i}]`, el);
				});
			}
		}

		new Notice('PDF view probed. Check console.');
	}

	private attachOverlayToActivePdfView() {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return;
		const container = leaf.view.containerEl;

		this.upgradePages(container);

		const obs = new MutationObserver(() => this.upgradePages(container));
		obs.observe(container, { childList: true, subtree: true });
		this.observers.push(obs);
		console.log(`${PLUGIN_LOG} observer attached to PDF view`);
	}

	private upgradePages(container: HTMLElement) {
		const pages = container.querySelectorAll<HTMLElement>('.page');
		pages.forEach((page) => this.ensureOverlayOnPage(page));
	}

	private ensureOverlayOnPage(page: HTMLElement) {
		const existing = page.querySelector<HTMLCanvasElement>(`canvas.${OVERLAY_CLASS}`);
		if (existing) {
			this.sizeOverlayToPage(existing, page);
			return;
		}

		const pageStyle = getComputedStyle(page);
		if (pageStyle.position === 'static') {
			page.style.position = 'relative';
		}

		const overlay = document.createElement('canvas');
		overlay.className = OVERLAY_CLASS;
		overlay.style.position = 'absolute';
		overlay.style.inset = '0';
		overlay.style.touchAction = 'none';
		overlay.style.pointerEvents = 'auto';
		overlay.style.zIndex = '1000';

		this.sizeOverlayToPage(overlay, page);
		page.appendChild(overlay);
		console.log(`${PLUGIN_LOG} overlay attached`, {
			pageNumber: page.getAttribute('data-page-number'),
			canvas: overlay,
		});

		this.disableTextLayerInteraction(page);
		this.wirePointerEvents(overlay);

		const pageObserver = new MutationObserver(() => {
			if (!page.contains(overlay)) {
				console.log(`${PLUGIN_LOG} overlay removed by PDF.js, re-adding`);
				this.disableTextLayerInteraction(page);
				this.sizeOverlayToPage(overlay, page);
				page.appendChild(overlay);
			} else {
				this.disableTextLayerInteraction(page);
			}
		});
		pageObserver.observe(page, { childList: true });
		this.observers.push(pageObserver);

		const resizeObserver = new ResizeObserver(() => {
			this.sizeOverlayToPage(overlay, page);
		});
		resizeObserver.observe(page);
	}

	private sizeOverlayToPage(overlay: HTMLCanvasElement, page: HTMLElement) {
		const rect = page.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) return;
		const targetW = Math.round(rect.width);
		const targetH = Math.round(rect.height);
		if (overlay.width !== targetW) overlay.width = targetW;
		if (overlay.height !== targetH) overlay.height = targetH;
		overlay.style.width = `${rect.width}px`;
		overlay.style.height = `${rect.height}px`;
	}

	private disableTextLayerInteraction(page: HTMLElement) {
		const textLayer = page.querySelector<HTMLElement>('.textLayer');
		if (textLayer && textLayer.style.pointerEvents !== 'none') {
			textLayer.style.pointerEvents = 'none';
		}
		const annotationLayer = page.querySelector<HTMLElement>('.annotationLayer');
		if (annotationLayer && annotationLayer.style.pointerEvents !== 'none') {
			annotationLayer.style.pointerEvents = 'none';
		}
	}

	private wirePointerEvents(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			console.error(`${PLUGIN_LOG} no 2d context`);
			return;
		}
		const applyStrokeStyle = () => {
			ctx.lineWidth = 2;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.strokeStyle = '#d33';
		};
		applyStrokeStyle();

		let stroke: Point[] | null = null;

		const toLocal = (e: PointerEvent): Point => {
			const rect = canvas.getBoundingClientRect();
			return { x: e.clientX - rect.left, y: e.clientY - rect.top };
		};

		canvas.addEventListener('pointerdown', (e) => {
			console.log(
				`${PLUGIN_LOG} pointerdown type=${e.pointerType} pressure=${e.pressure}`,
			);
			canvas.setPointerCapture(e.pointerId);
			applyStrokeStyle();
			const start = toLocal(e);
			stroke = [start];
			ctx.beginPath();
			ctx.moveTo(start.x, start.y);
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', (e) => {
			if (!stroke) return;
			const p = toLocal(e);
			stroke.push(p);
			ctx.lineTo(p.x, p.y);
			ctx.stroke();
			e.preventDefault();
		});

		const finish = (e: PointerEvent) => {
			if (!stroke) return;
			console.log(`${PLUGIN_LOG} stroke ended, points=${stroke.length}`);
			stroke = null;
			try {
				canvas.releasePointerCapture(e.pointerId);
			} catch (_) {}
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
	}
}
