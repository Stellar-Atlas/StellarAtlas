'use client';

import { useEffect, useState } from 'react';
import type { PublicNetwork } from '../../api/types';
import { publishLatestLedger } from '../../api/latest-ledger-events';
import { subscribeToLiveNetworkStream } from '../../api/live-network-stream';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { formatDateTime } from '../../format/formatters';

export function NetworkStrip(): React.JSX.Element {
	const [network, setNetwork] = useState<PublicNetwork | null>(null);
	const [liveLedger, setLiveLedger] = useState<string | null>(null);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);

	useEffect(
		() =>
			subscribeToLiveNetworkStream((message) => {
				if (message.type === 'network') {
					setNetwork(message.payload);
					publishLatestLedger(message.payload.latestLedger);
				}
				if (message.type === 'latestLedger') {
					publishLatestLedger(message.payload.sequence);
					setLatestLedger((current) => {
						return (
							getHighestLedgerSequence([current, message.payload.sequence]) ??
							current
						);
					});
				}
				if (message.type === 'scp') {
					const highestLedger = getHighestLedgerSequence(
						message.payload.map((statement) => statement.slotIndex)
					);
					if (!highestLedger) return;
					publishLatestLedger(highestLedger);
					setLiveLedger((current) => {
						return getHighestLedgerSequence([current, highestLedger]) ?? current;
					});
				}
			}),
		[]
	);

	const displayedLedger = getHighestLedgerSequence([
		liveLedger,
		latestLedger,
		network?.latestLedger
	]);

	return (
		<div className="network-strip">
			<div className="site-header-inner strip-inner">
				<div className="experience-switcher" aria-label="Site experience">
					<span>Modern update</span>
					<a href="/legacy/">Legacy version</a>
				</div>
				<span>{network?.name ?? 'Public Stellar Network'}</span>
				<span>Ledger {displayedLedger ?? 'syncing'}</span>
				<strong>{network ? formatDateTime(network.time) : 'Loading'}</strong>
			</div>
		</div>
	);
}
