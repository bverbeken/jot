export const PEN_HOLD_MIN_MS = 300;
export const PEN_HOLD_MAX_MS = 1500;
export const PEN_HOLD_STEP_MS = 100;

export interface PenHoldSettings {
	enabled: boolean;
	durationMs: number;
}

export function clampPenHoldMs(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return PEN_HOLD_MIN_MS;
	return Math.min(PEN_HOLD_MAX_MS, Math.max(PEN_HOLD_MIN_MS, value));
}
