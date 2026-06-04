import {
	JotFileFormat,
	buildJotPayload,
	dropStrokesForPdf,
	hasStrokesForPdf,
	migrateStroke,
	pageKey,
} from './jot-file';
import type { Stroke } from './strokes';

export class StrokeStore {
	private strokesByKey = new Map<string, Stroke[]>();

	forPage(pdfPath: string, pageNumber: number): Stroke[] {
		return this.strokesByKey.get(pageKey(pdfPath, pageNumber)) ?? [];
	}

	forKey(key: string): Stroke[] {
		return this.strokesByKey.get(key) ?? [];
	}

	hasKey(key: string): boolean {
		return this.strokesByKey.has(key);
	}

	setForKey(key: string, strokes: Stroke[]): void {
		this.strokesByKey.set(key, strokes);
	}

	appendToKey(key: string, stroke: Stroke): void {
		const existing = this.strokesByKey.get(key) ?? [];
		existing.push(stroke);
		this.strokesByKey.set(key, existing);
	}

	clearKey(key: string): void {
		this.strokesByKey.set(key, []);
	}

	hasFor(pdfPath: string): boolean {
		return hasStrokesForPdf(pdfPath, this.strokesByKey);
	}

	clearFor(pdfPath: string): void {
		dropStrokesForPdf(pdfPath, this.strokesByKey);
	}

	buildPayload(pdfPath: string): JotFileFormat | null {
		return buildJotPayload(pdfPath, this.strokesByKey);
	}

	populateFromPayload(pdfPath: string, pages: Record<string, Stroke[]>): void {
		for (const [pageNumStr, strokes] of Object.entries(pages)) {
			const pageNumber = parseInt(pageNumStr, 10);
			if (Number.isNaN(pageNumber)) continue;
			this.strokesByKey.set(pageKey(pdfPath, pageNumber), strokes.map(migrateStroke));
		}
	}

	keysForPage(pdfPath: string): string[] {
		const prefix = pdfPath + '::';
		return [...this.strokesByKey.keys()].filter((key) => key.startsWith(prefix));
	}

	asMap(): Map<string, Stroke[]> {
		return this.strokesByKey;
	}
}
