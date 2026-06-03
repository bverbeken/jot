import { Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';

const PLUGIN_LOG = '[obsidian-ink]';
const OVERLAY_CLASS = 'obsidian-ink-overlay';
const OVERLAY_KEY_ATTR = 'data-obsidian-ink-key';
const PAGE_OBSERVED_ATTR = 'data-obsidian-ink-observed';
const STROKE_COLOR = '#d33';
// Stroke width as a fraction of the page's rendered height — keeps lines
// looking the same thickness relative to the PDF at any zoom level.
const STROKE_WIDTH = 0.0025;
const INK_SUFFIX = '.ink.json';
const SAVE_DEBOUNCE_MS = 250;
const INK_FORMAT_VERSION = 1;

interface InkFileFormat {
	version: number;
	pages: Record<string, Stroke[]>;
}

interface NormalizedPoint {
	x: number;
	y: number;
	pressure: number;
}

interface Stroke {
	points: NormalizedPoint[];
	color: string;
	width: number;
}

const pageKey = (filePath: string, pageNumber: number) =>
	`${filePath}::${pageNumber}`;

function filePathFromKey(key: string): string | null {
	const idx = key.lastIndexOf('::');
	if (idx < 0) return null;
	return key.slice(0, idx);
}

export default class ObsidianInkPlugin extends Plugin {
	private containerObservers = new Map<WorkspaceLeaf, MutationObserver>();
	private strokes = new Map<string, Stroke[]>();
	private loaded = new Set<string>();
	private saveTimers = new Map<string, number>();

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
			this.app.workspace.on('file-open', async (file: TFile | null) => {
				if (file?.extension !== 'pdf') return;
				await this.ensureLoaded(file.path);
				setTimeout(() => this.attachOverlayToActivePdfView(), 300);
			}),
		);

		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				this.attachOverlayToActivePdfView();
			}),
		);

		// Pick up an already-open PDF on plugin enable / Obsidian restart.
		this.app.workspace.onLayoutReady(async () => {
			const filePath = this.getActivePdfFilePath();
			if (!filePath) return;
			await this.ensureLoaded(filePath);
			this.attachOverlayToActivePdfView();
		});
	}

	onunload() {
		this.containerObservers.forEach((o) => o.disconnect());
		this.containerObservers.clear();
		this.saveTimers.forEach((id) => window.clearTimeout(id));
		this.saveTimers.clear();
	}

	private inkPathFor(pdfPath: string): string {
		return pdfPath + INK_SUFFIX;
	}

	private async ensureLoaded(pdfPath: string) {
		if (this.loaded.has(pdfPath)) return;
		this.loaded.add(pdfPath);
		await this.loadFromDisk(pdfPath);
	}

	private async loadFromDisk(pdfPath: string) {
		const path = this.inkPathFor(pdfPath);
		try {
			if (!(await this.app.vault.adapter.exists(path))) return;
			const text = await this.app.vault.adapter.read(path);
			const parsed = JSON.parse(text) as InkFileFormat;
			if (parsed.version !== INK_FORMAT_VERSION) {
				console.warn(
					`${PLUGIN_LOG} ${path} has unknown version ${parsed.version}, skipping`,
				);
				return;
			}
			for (const [pageNumStr, strokes] of Object.entries(parsed.pages)) {
				const pageNumber = parseInt(pageNumStr, 10);
				if (Number.isNaN(pageNumber)) continue;
				this.strokes.set(pageKey(pdfPath, pageNumber), strokes);
			}
		} catch (err) {
			console.error(`${PLUGIN_LOG} loadFromDisk failed for ${path}:`, err);
		}
	}

	private async saveToDisk(pdfPath: string) {
		const pages: Record<string, Stroke[]> = {};
		const prefix = pdfPath + '::';
		for (const [key, strokes] of this.strokes.entries()) {
			if (!key.startsWith(prefix)) continue;
			if (strokes.length === 0) continue;
			pages[key.slice(prefix.length)] = strokes;
		}
		const path = this.inkPathFor(pdfPath);
		try {
			if (Object.keys(pages).length === 0) {
				if (await this.app.vault.adapter.exists(path)) {
					await this.app.vault.adapter.remove(path);
				}
				return;
			}
			const payload: InkFileFormat = {
				version: INK_FORMAT_VERSION,
				pages,
			};
			await this.app.vault.adapter.write(
				path,
				JSON.stringify(payload, null, 2),
			);
		} catch (err) {
			console.error(`${PLUGIN_LOG} saveToDisk failed for ${path}:`, err);
		}
	}

	private scheduleSave(pdfPath: string) {
		const existing = this.saveTimers.get(pdfPath);
		if (existing !== undefined) window.clearTimeout(existing);
		const id = window.setTimeout(() => {
			this.saveTimers.delete(pdfPath);
			void this.saveToDisk(pdfPath);
		}, SAVE_DEBOUNCE_MS);
		this.saveTimers.set(pdfPath, id);
	}

	private getActivePdfLeaf(): WorkspaceLeaf | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf) return null;
		const viewType = leaf.view.getViewType?.();
		if (viewType !== 'pdf') return null;
		return leaf;
	}

	private getActivePdfFilePath(): string | null {
		const leaf = this.getActivePdfLeaf();
		if (!leaf) return null;
		const file = (leaf.view as { file?: TFile }).file;
		return file?.path ?? null;
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
		const filePath = this.getActivePdfFilePath();
		if (!filePath) return;
		const container = leaf.view.containerEl;

		this.upgradePages(container, filePath);

		// One container observer per leaf — looks up the leaf's current file
		// path at fire time so it stays correct when the user navigates within
		// the same leaf. Without this guard, layout-change would attach a fresh
		// observer on every call and the accumulated set would freeze the UI.
		if (this.containerObservers.has(leaf)) return;
		const obs = new MutationObserver(() => {
			const currentPath = this.filePathForLeaf(leaf);
			if (!currentPath) return;
			this.upgradePages(container, currentPath);
		});
		obs.observe(container, { childList: true, subtree: true });
		this.containerObservers.set(leaf, obs);
	}

	private filePathForLeaf(leaf: WorkspaceLeaf): string | null {
		const file = (leaf.view as { file?: TFile }).file;
		return file?.path ?? null;
	}

	private upgradePages(container: HTMLElement, filePath: string) {
		const pages = container.querySelectorAll<HTMLElement>('.page');
		pages.forEach((page) => this.ensureOverlayOnPage(page, filePath));
	}

	private ensureOverlayOnPage(page: HTMLElement, filePath: string) {
		const pageNumberAttr = page.getAttribute('data-page-number');
		const pageNumber = pageNumberAttr ? parseInt(pageNumberAttr, 10) : NaN;
		if (Number.isNaN(pageNumber)) return;
		const key = pageKey(filePath, pageNumber);

		const existing = page.querySelector<HTMLCanvasElement>(
			`canvas.${OVERLAY_CLASS}`,
		);
		if (existing) {
			if (existing.getAttribute(OVERLAY_KEY_ATTR) === key) {
				this.sizeOverlayToPage(existing, page);
				this.redrawPage(existing);
				return;
			}
			// Stale overlay from a previous PDF — drop it and build fresh so
			// the wired event handlers reference the current file's key.
			existing.remove();
		}

		const pageStyle = getComputedStyle(page);
		if (pageStyle.position === 'static') {
			page.style.position = 'relative';
		}

		const overlay = document.createElement('canvas');
		overlay.className = OVERLAY_CLASS;
		overlay.setAttribute(OVERLAY_KEY_ATTR, key);
		overlay.style.position = 'absolute';
		overlay.style.inset = '0';
		overlay.style.touchAction = 'none';
		overlay.style.pointerEvents = 'auto';
		overlay.style.zIndex = '1000';

		this.sizeOverlayToPage(overlay, page);
		page.appendChild(overlay);

		this.disableTextLayerInteraction(page);
		this.wirePointerEvents(overlay);
		this.redrawPage(overlay);

		// Page-level observers are at most one per .page element across the
		// plugin's lifetime — guarded by a data attribute so they don't pile
		// up when overlays are replaced for a different PDF.
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

	private redrawPage(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
		if (!key) return;
		const strokes = this.strokes.get(key);
		if (!strokes || strokes.length === 0) return;
		for (const stroke of strokes) {
			drawStroke(ctx, stroke, canvas.width, canvas.height);
		}
	}

	private wirePointerEvents(canvas: HTMLCanvasElement) {
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			console.error(`${PLUGIN_LOG} no 2d context`);
			return;
		}

		let inProgress: NormalizedPoint[] | null = null;

		const toNormalized = (e: PointerEvent): NormalizedPoint => {
			const rect = canvas.getBoundingClientRect();
			return {
				x: (e.clientX - rect.left) / rect.width,
				y: (e.clientY - rect.top) / rect.height,
				pressure: e.pressure,
			};
		};

		canvas.addEventListener('pointerdown', (e) => {
			canvas.setPointerCapture(e.pointerId);
			const first = toNormalized(e);
			inProgress = [first];
			applyStrokeStyle(ctx, canvas.height);
			ctx.beginPath();
			ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', (e) => {
			if (!inProgress) return;
			const p = toNormalized(e);
			inProgress.push(p);
			ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
			ctx.stroke();
			e.preventDefault();
		});

		const finish = (e: PointerEvent) => {
			if (!inProgress) return;
			const stroke: Stroke = {
				points: inProgress,
				color: STROKE_COLOR,
				width: STROKE_WIDTH,
			};
			const key = canvas.getAttribute(OVERLAY_KEY_ATTR);
			if (key) {
				const existing = this.strokes.get(key) ?? [];
				existing.push(stroke);
				this.strokes.set(key, existing);
				const pdfPath = filePathFromKey(key);
				if (pdfPath) this.scheduleSave(pdfPath);
			}
			inProgress = null;
			try {
				canvas.releasePointerCapture(e.pointerId);
			} catch (_) {}
			this.redrawPage(canvas);
		};
		canvas.addEventListener('pointerup', finish);
		canvas.addEventListener('pointercancel', finish);
	}
}

function applyStrokeStyle(ctx: CanvasRenderingContext2D, canvasHeight: number) {
	ctx.lineWidth = STROKE_WIDTH * canvasHeight;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.strokeStyle = STROKE_COLOR;
}

function drawStroke(
	ctx: CanvasRenderingContext2D,
	stroke: Stroke,
	width: number,
	height: number,
) {
	if (stroke.points.length === 0) return;
	ctx.lineWidth = stroke.width * height;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	ctx.strokeStyle = stroke.color;
	ctx.beginPath();
	let started = false;
	for (const p of stroke.points) {
		if (!started) {
			ctx.moveTo(p.x * width, p.y * height);
			started = true;
		} else {
			ctx.lineTo(p.x * width, p.y * height);
		}
	}
	ctx.stroke();
}
