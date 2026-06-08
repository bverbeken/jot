import { App, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
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

	private async resetPaletteColors(): Promise<void> {
		this.plugin.settings.colors = [...PALETTE_COLORS];
		await this.plugin.saveSettings();
		this.update();
	}

	override getControlValue(key: string): unknown {
		const index = parseColorKey(key);
		if (index !== null) {
			return this.plugin.settings.colors[index] ?? PALETTE_COLORS[index];
		}
		return super.getControlValue(key);
	}

	override async setControlValue(key: string, value: unknown): Promise<void> {
		const index = parseColorKey(key);
		if (index !== null) {
			this.plugin.settings.colors[index] = String(value);
			await this.plugin.saveSettings();
			return;
		}
		await super.setControlValue(key, value);
	}
}
