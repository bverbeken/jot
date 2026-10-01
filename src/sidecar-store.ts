import type { DataAdapter } from 'obsidian';
import {
	isSupportedVersion,
	jotPathFor,
	parseJotText,
} from './jot-file';
import type { StrokeStore } from './stroke-store';

const SAVE_DEBOUNCE_MS = 250;
const PLUGIN_LOG = '[jot]';

export class SidecarStore {
	private saveTimers = new Map<string, number>();
	// What we last wrote to each sidecar, so a modify event can be told apart
	// from our own write echoing back through sync.
	private lastWritten = new Map<string, string>();

	constructor(
		private adapter: DataAdapter,
		private strokes: StrokeStore,
	) {}

	async load(pdfPath: string): Promise<void> {
		const path = jotPathFor(pdfPath);
		this.lastWritten.delete(path);
		this.strokes.clearFor(pdfPath);
		try {
			if (!(await this.adapter.exists(path))) return;
			const text = await this.adapter.read(path);
			const parsed = parseJotText(text);
			if (!parsed) return;
			if (!isSupportedVersion(parsed.version)) {
				console.warn(`${PLUGIN_LOG} ${path} has unknown version ${parsed.version}, skipping`);
				return;
			}
			this.strokes.populateFromPayload(pdfPath, parsed.pages);
		} catch (err) {
			console.error(`${PLUGIN_LOG} load failed for ${path}:`, err);
		}
	}

	async save(pdfPath: string): Promise<void> {
		const path = jotPathFor(pdfPath);
		const payload = this.strokes.buildPayload(pdfPath);
		try {
			if (!payload) {
				this.lastWritten.delete(path);
				if (await this.adapter.exists(path)) {
					await this.adapter.remove(path);
				}
				return;
			}
			const text = JSON.stringify(payload, null, 2);
			this.lastWritten.set(path, text);
			await this.adapter.write(path, text);
		} catch (err) {
			console.error(`${PLUGIN_LOG} save failed for ${path}:`, err);
		}
	}

	scheduleSave(pdfPath: string): void {
		const existing = this.saveTimers.get(pdfPath);
		if (existing !== undefined) window.clearTimeout(existing);
		const id = window.setTimeout(() => {
			this.saveTimers.delete(pdfPath);
			void this.save(pdfPath);
		}, SAVE_DEBOUNCE_MS);
		this.saveTimers.set(pdfPath, id);
	}

	/** True when the sidecar on disk is exactly what we last wrote, i.e. nothing new to load. */
	async isOwnSave(path: string): Promise<boolean> {
		const written = this.lastWritten.get(path);
		if (written === undefined) return false;
		try {
			return (await this.adapter.read(path)) === written;
		} catch {
			return false;
		}
	}

	async discard(pdfPath: string): Promise<void> {
		const path = jotPathFor(pdfPath);
		this.lastWritten.delete(path);
		try {
			if (await this.adapter.exists(path)) {
				await this.adapter.remove(path);
			}
		} catch (err) {
			console.error(`${PLUGIN_LOG} could not delete sidecar ${path}:`, err);
		}
	}

	cancelAllPending(): void {
		this.saveTimers.forEach((id) => window.clearTimeout(id));
		this.saveTimers.clear();
	}
}
