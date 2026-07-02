'use client';

import { useEffect, useState } from 'react';
import type { PublicNetwork } from '../../api/types';
import { formatDateTime } from '../../format/formatters';

const refreshIntervalMs = 60_000;

async function fetchNetwork(signal: AbortSignal): Promise<PublicNetwork> {
	const response = await fetch('/v1', {
		headers: { Accept: 'application/json' },
		signal
	});

	if (!response.ok)
		throw new Error(`Network request returned ${response.status}`);
	return response.json() as Promise<PublicNetwork>;
}

export function NetworkStrip(): React.JSX.Element {
	const [network, setNetwork] = useState<PublicNetwork | null>(null);

	useEffect(() => {
		const abortController = new AbortController();
		const loadNetwork = (): void => {
			void fetchNetwork(abortController.signal)
				.then(setNetwork)
				.catch(() => undefined);
		};
		loadNetwork();
		const interval = window.setInterval(loadNetwork, refreshIntervalMs);

		return () => {
			abortController.abort();
			window.clearInterval(interval);
		};
	}, []);

	return (
		<div className="network-strip">
			<div className="site-header-inner strip-inner">
				<div className="experience-switcher" aria-label="Site experience">
					<span>Modern update</span>
					<a href="/legacy/">Legacy version</a>
				</div>
				<span>{network?.name ?? 'Public Stellar Network'}</span>
				<span>
					Ledger {network?.latestLedger ? network.latestLedger : 'syncing'}
				</span>
				<strong>{network ? formatDateTime(network.time) : 'Loading'}</strong>
			</div>
		</div>
	);
}
