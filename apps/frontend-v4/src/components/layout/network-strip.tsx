'use client';

import { useEffect, useState } from 'react';
import type { PublicNetwork } from '../../api/types';
import {
	buildBrowserApiUrl,
	fetchBrowserLatestLedger,
	fetchBrowserPublicNetwork,
	fetchBrowserScpStatements
} from '../../api/browser-client';
import { formatDateTime } from '../../format/formatters';

const fallbackRefreshIntervalMs = 10_000;
const scpRefreshIntervalMs = 1_000;
const latestLedgerRefreshIntervalMs = 2_000;
const liveNetworkPath = '/v1/live';

const getHighestLedgerSlot = (slotIndexes: readonly string[]): string | null =>
	slotIndexes.reduce<string | null>((highest, slotIndex) => {
		if (highest === null) return slotIndex;
		return BigInt(slotIndex) > BigInt(highest) ? slotIndex : highest;
	}, null);

export function NetworkStrip(): React.JSX.Element {
	const [network, setNetwork] = useState<PublicNetwork | null>(null);
	const [liveLedger, setLiveLedger] = useState<string | null>(null);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadNetwork = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserPublicNetwork(abortController.signal)
				.then((nextNetwork) => {
					if (isMounted) setNetwork(nextNetwork);
				})
				.catch(() => undefined)
				.finally(() => {
					pendingRequests.delete(abortController);
				});
		};

		loadNetwork();
		const interval = window.setInterval(loadNetwork, fallbackRefreshIntervalMs);

		const eventSource = new EventSource(buildBrowserApiUrl(liveNetworkPath, true));
		eventSource.addEventListener('network', (event) => {
			if (!isMounted) return;
			setNetwork(JSON.parse(event.data) as PublicNetwork);
		});
		eventSource.onerror = () => {
			loadNetwork();
		};

		return () => {
			isMounted = false;
			eventSource.close();
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadLatestLedger = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserLatestLedger(abortController.signal)
				.then((ledger) => {
					if (!isMounted) return;
					setLatestLedger((current) => {
						if (!current) return ledger.sequence;
						return BigInt(ledger.sequence) > BigInt(current)
							? ledger.sequence
							: current;
					});
				})
				.catch(() => undefined)
				.finally(() => {
					pendingRequests.delete(abortController);
				});
		};

		loadLatestLedger();
		const interval = window.setInterval(
			loadLatestLedger,
			latestLedgerRefreshIntervalMs
		);
		return () => {
			isMounted = false;
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadScpLedger = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserScpStatements({ limit: 16 }, abortController.signal)
				.then((statements) => {
					const highestLedger = getHighestLedgerSlot(
						statements.map((statement) => statement.slotIndex)
					);
					if (isMounted && highestLedger) {
						setLiveLedger((current) => {
							if (!current) return highestLedger;
							return BigInt(highestLedger) > BigInt(current)
								? highestLedger
								: current;
						});
					}
				})
				.catch(() => undefined)
				.finally(() => {
					pendingRequests.delete(abortController);
				});
		};

		loadScpLedger();
		const interval = window.setInterval(loadScpLedger, scpRefreshIntervalMs);
		return () => {
			isMounted = false;
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	const displayedLedger = getHighestLedgerSlot(
		[liveLedger, latestLedger, network?.latestLedger.toString()].filter(
			(value): value is string => typeof value === 'string'
		)
	);

	return (
		<div className="network-strip">
			<div className="site-header-inner strip-inner">
				<div className="experience-switcher" aria-label="Site experience">
					<span>Modern update</span>
					<a href="/legacy/">Legacy version</a>
				</div>
				<span>{network?.name ?? 'Public Stellar Network'}</span>
				<span>
					Ledger {displayedLedger ?? 'syncing'}
				</span>
				<strong>{network ? formatDateTime(network.time) : 'Loading'}</strong>
			</div>
		</div>
	);
}
