'use client';

import { useEffect, useRef, useState } from 'react';
import {
	archiveInventoryRefreshFailed,
	archiveInventoryRefreshSucceeded,
	type ArchiveInventorySnapshot,
	type ArchiveInventoryState
} from '@api/archive-inventory-snapshot';
import { ArchiveInventoryView } from './archive-inventory-view';

export function ArchiveInventoryLive({
	initialSnapshot
}: {
	readonly initialSnapshot: ArchiveInventorySnapshot | null;
}): React.JSX.Element {
	const [state, setState] = useState<ArchiveInventoryState>(() =>
		initialSnapshot
			? { snapshot: initialSnapshot, error: null }
			: archiveInventoryRefreshFailed({ snapshot: null, error: null })
	);
	const [refreshing, setRefreshing] = useState(false);
	const refresh = useRef<() => void>(() => {});

	useEffect(() => {
		let disposed = false;
		let inFlight: AbortController | null = null;
		const load = async (): Promise<void> => {
			if (inFlight !== null || document.visibilityState === 'hidden') return;
			const controller = new AbortController();
			inFlight = controller;
			setRefreshing(true);
			const timeout = window.setTimeout(() => controller.abort(), 12_000);
			try {
				const response = await fetch('/api/archive-inventory', {
					signal: controller.signal
				});
				if (!response.ok) throw new Error('Archive inventory request failed');
				const snapshot: ArchiveInventorySnapshot = await response.json();
				if (
					!snapshot?.summary?.canonicalProofProgress ||
					!Array.isArray(snapshot.summary.sources) ||
					!Array.isArray(snapshot.nodes) ||
					!Array.isArray(snapshot.organizations)
				)
					throw new Error('Archive inventory response is invalid');
				if (!disposed)
					setState((previous) =>
						archiveInventoryRefreshSucceeded(previous, snapshot)
					);
			} catch {
				if (!disposed) setState(archiveInventoryRefreshFailed);
			} finally {
				window.clearTimeout(timeout);
				inFlight = null;
				if (!disposed) setRefreshing(false);
			}
		};
		refresh.current = () => {
			void load();
		};
		if (initialSnapshot === null) void load();
		const timer = window.setInterval(() => {
			void load();
		}, 30_000);
		const visible = (): void => {
			if (document.visibilityState === 'visible') void load();
		};
		document.addEventListener('visibilitychange', visible);
		return () => {
			disposed = true;
			inFlight?.abort();
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
