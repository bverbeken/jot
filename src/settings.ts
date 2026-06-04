import { App, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_TOOL_STATE, Handedness, ToolState } from './palette';
import type JotPlugin from './main';

export type { Handedness };

export interface JotSettings {
	handedness: Handedness;
	// Last-used tool state — restored on plugin load so reopening Obsidian
	// keeps you on the pen/color/width you were using rather than dumping
	// you back on the hard-coded default.
	toolState: ToolState;
}

export const DEFAULT_SETTINGS: JotSettings = {
	handedness: 'right',
	toolState: { ...DEFAULT_TOOL_STATE },
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
	}
}
