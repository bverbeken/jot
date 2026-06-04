import type { Stroke } from './strokes';

export const JOT_SUFFIX = '.jot.json';
export const JOT_FORMAT_VERSION = 2;
export const PAGE_KEY_SEPARATOR = '::';

export interface JotFileFormat {
	version: number;
	pages: Record<string, Stroke[]>;
}

export function jotPathFor(pdfPath: string): string {
	return pdfPath + JOT_SUFFIX;
}

export function isSidecarPath(path: string): boolean {
	return path.endsWith(JOT_SUFFIX);
}

export function pdfPathFromSidecar(sidecarPath: string): string | null {
	if (!sidecarPath.endsWith(JOT_SUFFIX)) return null;
	return sidecarPath.slice(0, -JOT_SUFFIX.length);
}

export function pageKey(pdfPath: string, pageNumber: number): string {
	return `${pdfPath}${PAGE_KEY_SEPARATOR}${pageNumber}`;
}

export function pdfPathFromKey(key: string): string | null {
	const separatorIndex = key.lastIndexOf(PAGE_KEY_SEPARATOR);
	return separatorIndex < 0 ? null : key.slice(0, separatorIndex);
}

export function parseJotText(text: string): JotFileFormat | null {
	try {
		const parsed: unknown = JSON.parse(text);
		if (!isJotFile(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function isSupportedVersion(version: number): boolean {
	return version === JOT_FORMAT_VERSION || version === 1;
}

export function migrateStroke(raw: Partial<Stroke>): Stroke {
	return {
		points: raw.points ?? [],
		color: raw.color ?? '#000000',
		width: raw.width ?? 0.0025,
		tool: raw.tool ?? 'pen',
	};
}

export function hasStrokesForPdf(pdfPath: string, strokesByKey: Map<string, Stroke[]>): boolean {
	const prefix = pdfPath + PAGE_KEY_SEPARATOR;
	for (const [key, strokes] of strokesByKey.entries()) {
		if (key.startsWith(prefix) && strokes.length > 0) return true;
	}
	return false;
}

export function dropStrokesForPdf(pdfPath: string, strokesByKey: Map<string, Stroke[]>): void {
	const prefix = pdfPath + PAGE_KEY_SEPARATOR;
	for (const key of [...strokesByKey.keys()]) {
		if (key.startsWith(prefix)) strokesByKey.delete(key);
	}
}

export function buildJotPayload(
	pdfPath: string,
	strokesByKey: Map<string, Stroke[]>,
): JotFileFormat | null {
	const prefix = pdfPath + PAGE_KEY_SEPARATOR;
	const pages: Record<string, Stroke[]> = {};
	for (const [key, strokes] of strokesByKey.entries()) {
		if (!key.startsWith(prefix)) continue;
		if (strokes.length === 0) continue;
		pages[key.slice(prefix.length)] = strokes;
	}
	if (Object.keys(pages).length === 0) return null;
	return { version: JOT_FORMAT_VERSION, pages };
}

function isJotFile(value: unknown): value is JotFileFormat {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.version !== 'number') return false;
	if (typeof candidate.pages !== 'object' || candidate.pages === null) return false;
	return true;
}
