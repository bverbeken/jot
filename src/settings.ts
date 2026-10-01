import { App, ColorComponent, PluginSettingTab, Setting } from 'obsidian';
import {
	DEFAULT_HIGHLIGHTER_MEMORY,
	DEFAULT_PEN_MEMORY,
	DEFAULT_TOOL_STATE,
	Handedness,
	PALETTE_COLORS,
	ToolMemory,
	ToolState,
} from './palette';
import { PEN_HOLD_MAX_MS, PEN_HOLD_MIN_MS, PEN_HOLD_STEP_MS } from './pen-hold';
import type JotPlugin from './main';

export type { Handedness };

export interface JotSettings {
	handedness: Handedness;
	penHoldOpensPalette: boolean;
	penHoldMs: number;
	toolState: ToolState;
	penState: ToolMemory;
	highlighterState: ToolMemory;
	colors: string[];
}

export const DEFAULT_SETTINGS: JotSettings = {
	handedness: 'right',
	penHoldOpensPalette: true,
	penHoldMs: PEN_HOLD_MIN_MS,
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

	override display(): void {
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

		let holdDuration: Setting | null = null;
		new Setting(containerEl)
			.setName('Open palette with pen hold')
			.setDesc('When off, only a two-finger hold opens the palette.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.penHoldOpensPalette).onChange(async (value) => {
					this.plugin.settings.penHoldOpensPalette = value;
					holdDuration?.setDisabled(!value);
					await this.plugin.saveSettings();
				}),
			);

		holdDuration = new Setting(containerEl)
			.setName('Pen hold duration')
			.setDesc(
				'Milliseconds to hold the pen still before the palette opens. Raise it if the palette opens while you write.',
			)
			.addSlider((slider) =>
				slider
					.setLimits(PEN_HOLD_MIN_MS, PEN_HOLD_MAX_MS, PEN_HOLD_STEP_MS)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.penHoldMs)
					.onChange(async (value) => {
						this.plugin.settings.penHoldMs = value;
						await this.plugin.saveSettings();
					}),
			)
			.setDisabled(!this.plugin.settings.penHoldOpensPalette);

		new Setting(containerEl)
			.setName('Palette colors')
			.setDesc('The seven swatches shown in the color sub-arc.')
			.setHeading();

		const pickers: ColorComponent[] = [];
		PALETTE_COLORS.forEach((_, index) => {
			new Setting(containerEl)
				.setName(`Color ${index + 1}`)
				.addColorPicker((picker) => {
					pickers[index] = picker;
					picker
						.setValue(this.plugin.settings.colors[index] ?? PALETTE_COLORS[index]!)
						.onChange(async (value) => {
							this.plugin.settings.colors[index] = value;
							await this.plugin.saveSettings();
						});
				});
		});

		new Setting(containerEl).addButton((button) =>
			button.setButtonText('Reset palette colors to defaults').onClick(async () => {
				this.plugin.settings.colors = [...PALETTE_COLORS];
				await this.plugin.saveSettings();
				PALETTE_COLORS.forEach((color, i) => {
					pickers[i]?.setValue(color);
				});
			}),
		);
	}
}
