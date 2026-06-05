import { setIcon } from 'obsidian';
import { isDarkColor } from './palette-color';

const CONFIRM_DISMISS_MS = 280;
const CONFIRM_DISMISS_MS_REDUCED_MOTION = 80;

const CONFIRM_CLASS = 'jot-palette-confirm';
const ON_SWATCH_CLASS = 'on-swatch';
const VISIBLE_CLASS = 'is-visible';

export class ConfirmAnimator {
	constructor(private onDismiss: () => void) {}

	flashAndDismiss(btn: HTMLElement): void {
		const doc = btn.ownerDocument;
		const win = doc.defaultView ?? window;
		const check = this.buildCheck(doc, btn);
		btn.appendChild(check);
		win.requestAnimationFrame(() => check.classList.add(VISIBLE_CLASS));
		win.setTimeout(() => this.onDismiss(), this.dismissDelay(win));
	}

	private buildCheck(doc: Document, btn: HTMLElement): HTMLElement {
		const check = doc.createElement('span');
		check.className = CONFIRM_CLASS;
		setIcon(check, 'check');
		const swatchColor = btn.dataset.color;
		if (swatchColor) {
			check.classList.add(ON_SWATCH_CLASS);
			check.style.color = isDarkColor(swatchColor) ? '#fff' : '#000';
		}
		return check;
	}

	private dismissDelay(win: Window): number {
		const reducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
		return reducedMotion ? CONFIRM_DISMISS_MS_REDUCED_MOTION : CONFIRM_DISMISS_MS;
	}
}
