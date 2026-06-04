import { App, Modal } from 'obsidian';
import { LineCapStyle, PDFPage, rgb } from 'pdf-lib';
import {
	forEachSmoothSegment,
	HIGHLIGHTER_ALPHA,
	HIGHLIGHTER_WIDTH_FACTOR,
	PRESSURE_MAX_FACTOR,
	PRESSURE_MIN_FACTOR,
	Stroke,
} from './strokes';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
	return {
		r: (parseInt(h.slice(0, 2), 16) || 0) / 255,
		g: (parseInt(h.slice(2, 4), 16) || 0) / 255,
		b: (parseInt(h.slice(4, 6), 16) || 0) / 255,
	};
}

export function drawStrokesOnPdfPage(page: PDFPage, strokes: Stroke[]) {
	const pageW = page.getWidth();
	const pageH = page.getHeight();
	for (const stroke of strokes) {
		if (stroke.points.length < 2) continue;
		const c = hexToRgb(stroke.color);
		const baseWidth = stroke.width * pageH;
		const color = rgb(c.r, c.g, c.b);
		if (stroke.tool === 'highlighter') {
			const thickness = baseWidth * HIGHLIGHTER_WIDTH_FACTOR;
			for (let i = 1; i < stroke.points.length; i++) {
				const a = stroke.points[i - 1];
				const b = stroke.points[i];
				if (!a || !b) continue;
				page.drawLine({
					start: { x: a.x * pageW, y: pageH - a.y * pageH },
					end: { x: b.x * pageW, y: pageH - b.y * pageH },
					thickness,
					color,
					opacity: HIGHLIGHTER_ALPHA,
					lineCap: LineCapStyle.Butt,
				});
			}
			continue;
		}
		forEachSmoothSegment(stroke.points, (a, b) => {
			const avgPressure = (a.pressure + b.pressure) / 2;
			const clamped = Math.max(0, Math.min(1, avgPressure));
			const factor =
				PRESSURE_MIN_FACTOR +
				(PRESSURE_MAX_FACTOR - PRESSURE_MIN_FACTOR) * clamped;
			page.drawLine({
				start: { x: a.x * pageW, y: pageH - a.y * pageH },
				end: { x: b.x * pageW, y: pageH - b.y * pageH },
				thickness: baseWidth * factor,
				color,
				opacity: 1,
				lineCap: LineCapStyle.Round,
			});
		});
	}
}

export class ExportChoiceModal extends Modal {
	private onChoice: (choice: 'overwrite' | 'copy' | 'cancel') => void;
	private copyTarget: string;

	constructor(
		app: App,
		copyTarget: string,
		onChoice: (choice: 'overwrite' | 'copy' | 'cancel') => void,
	) {
		super(app);
		this.copyTarget = copyTarget;
		this.onChoice = onChoice;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Merge notes into PDF' });
		contentEl.createEl('p', {
			text: 'Bake the strokes for this PDF into a PDF file. The sidecar .jot.json is dropped only if you overwrite the original.',
		});
		const annotatedName = this.copyTarget.replace(/.*\//, '');
		const buttons = contentEl.createDiv({ cls: 'jot-modal-buttons' });
		const copyBtn = buttons.createEl('button', {
			text: `Save as "${annotatedName}"`,
		});
		copyBtn.classList.add('mod-cta');
		copyBtn.addEventListener('click', () => {
			this.onChoice('copy');
			this.close();
		});
		const overwriteBtn = buttons.createEl('button', {
			text: 'Overwrite original',
		});
		overwriteBtn.addEventListener('click', () => {
			this.onChoice('overwrite');
			this.close();
		});
		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => {
			this.onChoice('cancel');
			this.close();
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
