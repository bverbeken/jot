export class OutsideCloseListener {
	private handler: ((e: PointerEvent) => void) | null = null;
	private boundDoc: Document | null = null;

	constructor(
		private element: () => HTMLElement | null,
		private onOutsideClick: () => void,
	) {}

	attach(doc: Document): void {
		const handler = (e: PointerEvent) => {
			const element = this.element();
			if (!element) return;
			const target = e.target as Node | null;
			if (target && element.contains(target)) return;
			this.onOutsideClick();
		};
		this.handler = handler;
		this.boundDoc = doc;
		window.setTimeout(() => {
			if (this.handler === handler) {
				doc.addEventListener('pointerdown', handler, true);
			}
		}, 0);
	}

	detach(): void {
		if (this.handler && this.boundDoc) {
			this.boundDoc.removeEventListener('pointerdown', this.handler, true);
		}
		this.handler = null;
		this.boundDoc = null;
	}
}
