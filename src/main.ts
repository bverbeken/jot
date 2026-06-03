import { Notice, Plugin } from 'obsidian';

export default class ObsidianInkPlugin extends Plugin {
	async onload() {
		this.addRibbonIcon('pencil', 'Obsidian Ink', () => {
			new Notice('Obsidian Ink loaded');
		});
	}

	onunload() {}
}
