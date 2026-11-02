'use client';

import { useEffect, useRef, useState } from 'react';
import {
	archiveInventoryRefreshFailed,
	archiveInventoryRefreshSucceeded,
	type ArchiveInventorySnapshot,
	type ArchiveInventoryState
} from '@api/archive-inventory-snapshot';
import {
	getCachedArchiveInventorySnapshot,
	loadArchiveInventorySnapshot,
	rememberArchiveInventorySnapshot
} from '@api/archive-inventory-client';
import { ArchiveInventoryView } from './archive-inventory-view';

export function ArchiveInventoryLive({
	initialSnapshot
}: {
	readonly initialSnapshot: ArchiveInventorySnapshot | null;
}): React.JSX.Element {
	const [state, setState] = useState<ArchiveInventoryState>(() => {
		const cached = getCachedArchiveInventorySnapshot();
		const initialIsNewer =
			initialSnapshot !== null &&
			(cached === null ||
				Date.parse(initialSnapshot.summary.generatedAt) >=
					Date.parse(cached.summary.generatedAt));
		const startingSnapshot = initialIsNewer ? initialSnapshot : cached;
		return startingSnapshot
			? { snapshot: startingSnapshot, error: null }
			: archiveInventoryRefreshFailed({ snapshot: null, error: null });
	});
	const [refreshing, setRefreshing] = useState(false);
	const refresh = useRef<() => void>(() => {});

	useEffect(() => {
		let disposed = false;
		const load = async (): Promise<void> => {
			if (document.visibilityState === 'hidden') return;
			setRefreshing(true);
			try {
				const snapshot = await loadArchiveInventorySnapshot();
				if (!disposed)
					setState((previous) =>
						archiveInventoryRefreshSucceeded(previous, snapshot)
					);
			} catch {
				if (!disposed) setState(archiveInventoryRefreshFailed);
			} finally {
				if (!disposed) setRefreshing(false);
			}
		};
		refresh.current = () => {
			void load();
		};
		if (initialSnapshot !== null) rememberArchiveInventorySnapshot(initialSnapshot);
		if (getCachedArchiveInventorySnapshot() === null) void load();
		const timer = window.setInterval(() => {
			void load();
		}, 30_000);
		const visible = (): void => {
			if (document.visibilityState === 'visible') void load();
		};
		document.addEventListener('visibilitychange', visible);
		return () => {
			disposed = true;
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', visible);
			refresh.current = () => {};
		};
	}, [initialSnapshot]);

	return (
		<>
			{state.error !== null && (
				<section
					className="panel detail-panel"
					role="status"
					aria-label="Archive update status"
				>
					<p>{state.error}</p>
					<button
						type="button"
						className="primary-button"
						disabled={refreshing}
						onClick={() => refresh.current()}
					>
						{refreshing ? 'Refreshing' : 'Retry archive updates'}
					</button>
				</section>
			)}
			{state.snapshot !== null && (
				<ArchiveInventoryView snapshot={state.snapshot} />
			)}
		</>
	);
}
