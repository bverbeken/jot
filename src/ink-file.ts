import type { Stroke } from './strokes';

export const INK_SUFFIX = '.ink.json';
export const INK_FORMAT_VERSION = 2;
export const PAGE_KEY_SEPARATOR = '::';

export interface InkFileFormat {
	version: number;
	pages: Record<string, Stroke[]>;
}

export function inkPathFor(pdfPath: string): string {
	return pdfPath + INK_SUFFIX;
}

export function pageKey(pdfPath: string, pageNumber: number): string {
	return `${pdfPath}${PAGE_KEY_SEPARATOR}${pageNumber}`;
}

export function pdfPathFromKey(key: string): string | null {
	const separatorIndex = key.lastIndexOf(PAGE_KEY_SEPARATOR);
	return separatorIndex < 0 ? null : key.slice(0, separatorIndex);
}

export function parseInkText(text: string): InkFileFormat | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (!isInkFile(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function isSupportedVersion(version: number): boolean {
	return version === INK_FORMAT_VERSION || version === 1;
}

export function migrateStroke(raw: Partial<Stroke>): Stroke {
	return {
		points: raw.points ?? [],
		color: raw.color ?? '#000000',
		width: raw.width ?? 0.0025,
		tool: raw.tool ?? 'pen',
	};
}

export function buildInkPayload(
	pdfPath: string,
	strokesByKey: Map<string, Stroke[]>,
): InkFileFormat | null {
	const prefix = pdfPath + PAGE_KEY_SEPARATOR;
	const pages: Record<string, Stroke[]> = {};
	for (const [key, strokes] of strokesByKey.entries()) {
		if (!key.startsWith(prefix)) continue;
		if (strokes.length === 0) continue;
		pages[key.slice(prefix.length)] = strokes;
	}
	if (Object.keys(pages).length === 0) return null;
	return { version: INK_FORMAT_VERSION, pages };
}

function isInkFile(value: unknown): value is InkFileFormat {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.version !== 'number') return false;
	if (typeof candidate.pages !== 'object' || candidate.pages === null) return false;
	return true;
}
