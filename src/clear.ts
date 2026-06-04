import { App, Modal } from 'obsidian';

export class ConfirmClearModal extends Modal {
	private pdfPath: string;
	private onConfirm: () => void;

	constructor(app: App, pdfPath: string, onConfirm: () => void) {
		super(app);
		this.pdfPath = pdfPath;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		const basename = this.pdfPath.replace(/.*\//, '');
		contentEl.createEl('h2', { text: 'Clear annotations?' });
		contentEl.createEl('p', {
			text: `Removes every stroke on every page of "${basename}". Undo restores them one page at a time.`,
		});
		const buttons = contentEl.createDiv({ cls: 'jot-modal-buttons' });
		const clearBtn = buttons.createEl('button', { text: 'Clear' });
		clearBtn.classList.add('mod-warning');
		clearBtn.addEventListener('click', () => {
			this.close();
			this.onConfirm();
		});
		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}
