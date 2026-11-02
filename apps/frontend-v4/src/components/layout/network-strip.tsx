'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { publishLatestLedger } from '../../api/latest-ledger-events';
import {
	subscribeToLiveNetworkStream,
	type LiveNetworkSubscriptionOptions
} from '../../api/live-network-stream';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { LocalDateTime } from '../local-date-time';
import styles from './network-strip.module.css';

const networkStripSubscription: LiveNetworkSubscriptionOptions = {
	// Older servers emit network snapshots and do not negotiate summary channels.
	channels: ['summary', 'network']
};

export function NetworkStrip(): React.JSX.Element {
	const pathname = usePathname();
	const compact = pathname === '/explorer' || pathname?.startsWith('/explorer/');
	const [networkName, setNetworkName] = useState<string | null>(null);
	const [networkTime, setNetworkTime] = useState<string | null>(null);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);

	useEffect(
		() =>
			subscribeToLiveNetworkStream((message) => {
				if (message.type === 'summary' || message.type === 'network') {
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
		<div className={'network-strip' + (compact ? ' ' + styles.compact : '')}>
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
