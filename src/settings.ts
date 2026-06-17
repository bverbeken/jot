import { App, ColorComponent, PluginSettingTab, Setting, type SettingDefinitionItem } from 'obsidian';
import {
	DEFAULT_HIGHLIGHTER_MEMORY,
	DEFAULT_PEN_MEMORY,
	DEFAULT_TOOL_STATE,
	Handedness,
	PALETTE_COLORS,
	ToolMemory,
	ToolState,
} from './palette';
import { colorKey, parseColorKey } from './settings-keys';
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

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const colorPickers: SettingDefinitionItem[] = PALETTE_COLORS.map((_, index) => ({
			name: `Color ${index + 1}`,
			control: {
				type: 'color',
				key: colorKey(index),
			},
		}));

		return [
			{
				name: 'Handedness',
				desc: "The palette fans away from your pen hand so it doesn't sit under your wrist.",
				control: {
					type: 'dropdown',
					key: 'handedness',
					options: { right: 'Right-handed', left: 'Left-handed' },
				},
			},
			{
				name: 'Palette colors',
				desc: 'The seven swatches shown in the color sub-arc.',
				render: (setting) => {
					setting.setHeading();
				},
			},
			...colorPickers,
			{
				name: 'Reset palette colors to defaults',
				action: () => {
					void this.resetPaletteColors();
				},
			},
		];
	}

	/**
	 * Imperative fallback for Obsidian < 1.13.0, which lacks the declarative
	 * getSettingDefinitions() API. On 1.13.0+ this is never called because
	 * getSettingDefinitions() returns a non-empty array.
	 */
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

	// The methods below are part of the declarative settings API (Obsidian
	// 1.13.0+). They are only ever invoked through getSettingDefinitions()'s
	// render path, which Obsidian runs exclusively on 1.13.0+. On older
	// versions the display() fallback above runs instead and never reaches
	// them, so the 1.13.0 API floor they touch is unreachable there.

	private async resetPaletteColors(): Promise<void> {
		this.plugin.settings.colors = [...PALETTE_COLORS];
		await this.plugin.saveSettings();
		// eslint-disable-next-line obsidianmd/no-unsupported-api -- declarative-path only; see note above
		this.update();
	}

	override getControlValue(key: string): unknown {
		const index = parseColorKey(key);
		if (index !== null) {
			return this.plugin.settings.colors[index] ?? PALETTE_COLORS[index];
		}
		// eslint-disable-next-line obsidianmd/no-unsupported-api -- declarative-path only; see note above
		return super.getControlValue(key);
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const index = parseColorKey(key);
		if (index !== null) {
			this.plugin.settings.colors[index] = String(value);
			await this.plugin.saveSettings();
			return;
		}
		// eslint-disable-next-line obsidianmd/no-unsupported-api -- declarative-path only; see note above
		await super.setControlValue(key, value);
	}
}
