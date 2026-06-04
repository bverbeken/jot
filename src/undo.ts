import type { Stroke } from './strokes';

export interface UndoEntry {
	pdfPath: string;
	key: string;
	prevStrokes: Stroke[];
}

export const MAX_UNDO_DEPTH = 50;

type StrokeReader = (key: string) => Stroke[];

export class UndoHistory {
	private undoStacks = new Map<string, UndoEntry[]>();
	private redoStacks = new Map<string, UndoEntry[]>();

	push(entry: UndoEntry): void {
		const stack = this.undoStacks.get(entry.pdfPath) ?? [];
		stack.push(entry);
		if (stack.length > MAX_UNDO_DEPTH) stack.shift();
		this.undoStacks.set(entry.pdfPath, stack);
		this.redoStacks.delete(entry.pdfPath);
	}

	canUndo(pdfPath: string): boolean {
		return (this.undoStacks.get(pdfPath)?.length ?? 0) > 0;
	}

	canRedo(pdfPath: string): boolean {
		return (this.redoStacks.get(pdfPath)?.length ?? 0) > 0;
	}

	popUndo(pdfPath: string, currentStrokesForKey: StrokeReader): UndoEntry | null {
		const stack = this.undoStacks.get(pdfPath);
		const entry = stack?.pop();
		if (!entry) return null;
		this.recordOpposite(this.redoStacks, pdfPath, entry.key, currentStrokesForKey);
		return entry;
	}

	popRedo(pdfPath: string, currentStrokesForKey: StrokeReader): UndoEntry | null {
		const stack = this.redoStacks.get(pdfPath);
		const entry = stack?.pop();
		if (!entry) return null;
		this.recordOpposite(this.undoStacks, pdfPath, entry.key, currentStrokesForKey);
		return entry;
	}

	dropPath(pdfPath: string): void {
		this.undoStacks.delete(pdfPath);
		this.redoStacks.delete(pdfPath);
	}

	private recordOpposite(
		stacks: Map<string, UndoEntry[]>,
		pdfPath: string,
		key: string,
		reader: StrokeReader,
	): void {
		const stack = stacks.get(pdfPath) ?? [];
		stack.push({ pdfPath, key, prevStrokes: [...reader(key)] });
		stacks.set(pdfPath, stack);
	}
}
