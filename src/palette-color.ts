const PERCEIVED_LUMINANCE_THRESHOLD = 140;

export function isDarkColor(hex: string): boolean {
	const cleaned = hex.replace('#', '');
	if (cleaned.length !== 6) return false;
	const r = parseInt(cleaned.slice(0, 2), 16);
	const g = parseInt(cleaned.slice(2, 4), 16);
	const b = parseInt(cleaned.slice(4, 6), 16);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return false;
	const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
	return luminance < PERCEIVED_LUMINANCE_THRESHOLD;
}
