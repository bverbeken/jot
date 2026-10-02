// The obsidian package ships types only; tests that import modules touching
// its runtime API resolve 'obsidian' here instead (see vitest.config.ts).
export function setIcon(): void {}
