/** Keep docs sticky rows below the actual site header, including an expanded menu. */
export function observeDocsHeaderOffset(
	container: HTMLElement,
	header: HTMLElement
): () => void {
	let active = true;
	let lastHeight = -1;
	const update = (): void => {
		if (!active) return;
		const height = header.getBoundingClientRect().height;
		if (!Number.isFinite(height) || height <= 0 || height === lastHeight)
			return;
		lastHeight = height;
		container.style.setProperty('--fd-banner-height', `${height}px`);
	};
	update();
	const observer =
		typeof ResizeObserver === 'undefined'
			? undefined
			: new ResizeObserver(update);
	observer?.observe(header);
	return () => {
		active = false;
		observer?.disconnect();
		container.style.removeProperty('--fd-banner-height');
	};
}
