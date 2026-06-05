import { App, PluginSettingTab, Setting } from 'obsidian';
import {
	DEFAULT_HIGHLIGHTER_MEMORY,
	DEFAULT_PEN_MEMORY,
	DEFAULT_TOOL_STATE,
	Handedness,
	PALETTE_COLORS,
	ToolMemory,
	ToolState,
} from './palette';
import type JotPlugin from './main';

export type { Handedness };

export interface JotSettings {
	handedness: Handedness;
	toolState: ToolState;
	penState: ToolMemory;
	highlighterState: ToolMemory;
	colors: string[];
}

export const DEFAULT_SETTINGS: JotSettings = {
	handedness: 'right',
	toolState: { ...DEFAULT_TOOL_STATE },
	penState: { ...DEFAULT_PEN_MEMORY },
	highlighterState: { ...DEFAULT_HIGHLIGHTER_MEMORY },
	colors: [...PALETTE_COLORS],
};

export class JotSettingTab extends PluginSettingTab {
	plugin: JotPlugin;

	constructor(app: App, plugin: JotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Handedness')
			.setDesc(
				"The palette fans away from your pen hand so it doesn't sit under your wrist.",
			)
			.addDropdown((d) =>
				d
					.addOption('right', 'Right-handed')
					.addOption('left', 'Left-handed')
					.setValue(this.plugin.settings.handedness)
					.onChange(async (value) => {
						this.plugin.settings.handedness = value as Handedness;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Palette colors')
			.setDesc('The seven swatches shown in the color sub-arc.')
			.setHeading();

		PALETTE_COLORS.forEach((_, index) => {
			new Setting(containerEl)
				.setName(`Color ${index + 1}`)
				.addColorPicker((picker) =>
					picker
						.setValue(this.plugin.settings.colors[index] ?? PALETTE_COLORS[index]!)
						.onChange(async (value) => {
							this.plugin.settings.colors[index] = value;
							await this.plugin.saveSettings();
						}),
				);
		});

		new Setting(containerEl)
			.addButton((button) =>
				button
					.setButtonText('Reset palette colors to defaults')
					.onClick(async () => {
						this.plugin.settings.colors = [...PALETTE_COLORS];
						await this.plugin.saveSettings();
						// eslint-disable-next-line @typescript-eslint/no-deprecated
						this.display();
					}),
			);
	}
}
