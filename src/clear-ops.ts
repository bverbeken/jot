import { PAGE_KEY_SEPARATOR } from './jot-file';
import type { Stroke } from './stroke-math';
import type { UndoEntry } from './undo';

export interface ClearOperation {
	key: string;
	prevStrokes: Stroke[];
}

export function collectClearOperations(
	pdfPath: string,
	strokes: Map<string, Stroke[]>,
): ClearOperation[] {
	const prefix = pdfPath + PAGE_KEY_SEPARATOR;
	const operations: ClearOperation[] = [];
	for (const [key, strokeList] of strokes.entries()) {
		if (!key.startsWith(prefix)) continue;
		if (strokeList.length === 0) continue;
		operations.push({ key, prevStrokes: [...strokeList] });
	}
	return operations;
}

export function countStrokes(operations: ClearOperation[]): number {
	return operations.reduce((sum, op) => sum + op.prevStrokes.length, 0);
}

export function toUndoEntries(
	pdfPath: string,
	operations: ClearOperation[],
): UndoEntry[] {
	return operations.map(({ key, prevStrokes }) => ({ pdfPath, key, prevStrokes }));
}
