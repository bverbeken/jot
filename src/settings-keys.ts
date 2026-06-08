const COLOR_KEY_PREFIX = 'colors.';

export function colorKey(index: number): string {
	return `${COLOR_KEY_PREFIX}${index}`;
}

export function parseColorKey(key: string): number | null {
	if (!key.startsWith(COLOR_KEY_PREFIX)) return null;
	const rest = key.slice(COLOR_KEY_PREFIX.length);
	if (!/^\d+$/.test(rest)) return null;
	return Number(rest);
}
