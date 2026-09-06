/** Keep the same-origin reference in the outer page's scroll flow. */
export function observeSwaggerFrame(frame: HTMLIFrameElement): () => void {
	const document = frame.contentDocument;
	if (!document?.body || typeof ResizeObserver === 'undefined') return () => {};
	const body = document.body;
	const root = document.documentElement;
	const resize = (): void => {
		const height = Math.ceil(
			Math.max(body.getBoundingClientRect().height, body.scrollHeight)
		);
		if (height > 0) frame.style.height = height + 'px';
	};
	const observer = new ResizeObserver(resize);
	observer.observe(body);
	resize();
	// Only suppress inner scrolling when measurement is supported.
	const previousOverflow = root.style.overflowY;
	root.style.overflowY = 'hidden';
	return () => {
		observer.disconnect();
		root.style.overflowY = previousOverflow;
	};
}
