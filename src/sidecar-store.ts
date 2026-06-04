import type { DataAdapter } from 'obsidian';
import {
	isSupportedVersion,
	jotPathFor,
	parseJotText,
} from './jot-file';
import type { StrokeStore } from './stroke-store';

const SAVE_DEBOUNCE_MS = 250;
const SELF_SAVE_SUPPRESS_MS = 1500;
const PLUGIN_LOG = '[jot]';

export class SidecarStore {
	private saveTimers = new Map<string, number>();
	private recentSelfSaves = new Map<string, number>();

	constructor(
		private adapter: DataAdapter,
		private strokes: StrokeStore,
	) {}

	async load(pdfPath: string): Promise<void> {
		const path = jotPathFor(pdfPath);
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
				if (await this.adapter.exists(path)) {
					await this.adapter.remove(path);
				}
				return;
			}
			await this.adapter.write(path, JSON.stringify(payload, null, 2));
			this.recentSelfSaves.set(path, Date.now());
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

	isOwnRecentSave(path: string): boolean {
		const writtenAt = this.recentSelfSaves.get(path);
		if (writtenAt === undefined) return false;
		if (Date.now() - writtenAt >= SELF_SAVE_SUPPRESS_MS) return false;
		this.recentSelfSaves.delete(path);
		return true;
	}

	async discard(pdfPath: string): Promise<void> {
		const path = jotPathFor(pdfPath);
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
