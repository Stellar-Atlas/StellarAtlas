'use client';

import { useEffect, useState } from 'react';
import { publishLatestLedger } from '../../api/latest-ledger-events';
import {
	subscribeToLiveNetworkStream,
	type LiveNetworkSubscriptionOptions
} from '../../api/live-network-stream';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { LocalDateTime } from '../local-date-time';

const networkStripSubscription: LiveNetworkSubscriptionOptions = {
	channels: ['summary']
};

export function NetworkStrip(): React.JSX.Element {
	const [networkName, setNetworkName] = useState<string | null>(null);
	const [networkTime, setNetworkTime] = useState<string | null>(null);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);

	useEffect(
		() =>
			subscribeToLiveNetworkStream((message) => {
				if (message.type === 'summary') {
					setNetworkName(message.payload.name);
					setNetworkTime(message.payload.time);
					publishLatestLedger(message.payload.latestLedger);
					setLatestLedger((current) =>
						getHighestLedgerSequence([
							current,
							message.payload.latestLedger
						]) ?? current
					);
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
			}, undefined, networkStripSubscription),
		[]
	);

	const displayedLedger = latestLedger;

	return (
		<div className="network-strip">
			<div className="site-header-inner strip-inner">
				<div className="experience-switcher" aria-label="Site experience">
					<span>Modern update</span>
					<a href="/legacy/">Legacy version</a>
				</div>
				<span>{networkName ?? 'Public Stellar Network'}</span>
				<span>Ledger {displayedLedger ?? 'syncing'}</span>
				<strong>
					Network snapshot:{' '}
					{networkTime ? <LocalDateTime dateTime={networkTime} /> : 'Loading'}
				</strong>
			</div>
		</div>
	);
}
