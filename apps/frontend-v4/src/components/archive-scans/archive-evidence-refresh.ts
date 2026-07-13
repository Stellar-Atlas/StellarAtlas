export interface ArchiveEvidenceRefreshClock {
	clearInterval(handle: number): void;
	isVisible(): boolean;
	setInterval(callback: () => void, intervalMs: number): number;
}

export function mergeArchiveEvidenceAggregate<
	Evidence extends object,
	Aggregate extends Partial<Evidence>
>(current: Evidence, aggregate: Aggregate): Evidence {
	return { ...current, ...aggregate };
}

export function shouldRefreshFirstArchiveEvidencePage(
	phase: 'error' | 'loading' | 'ready',
	pageIndex: number | undefined,
	requestActive = false,
	requestUnchanged = true
): boolean {
	return (
		requestUnchanged &&
		!requestActive &&
		phase !== 'loading' &&
		pageIndex === 0
	);
}

export function startBoundedArchiveEvidenceRefresh(
	refresh: () => Promise<void>,
	intervalMs: number,
	clock: ArchiveEvidenceRefreshClock = browserRefreshClock()
): () => void {
	let active = false;
	let disposed = false;
	const handle = clock.setInterval(() => {
		if (disposed || active || !clock.isVisible()) return;
		active = true;
		void refresh().finally(() => {
			active = false;
		});
	}, intervalMs);
	return () => {
		disposed = true;
		clock.clearInterval(handle);
	};
}

function browserRefreshClock(): ArchiveEvidenceRefreshClock {
	return {
		clearInterval: (handle) => window.clearInterval(handle),
		isVisible: () => document.visibilityState !== 'hidden',
		setInterval: (callback, intervalMs) =>
			window.setInterval(callback, intervalMs)
	};
}
