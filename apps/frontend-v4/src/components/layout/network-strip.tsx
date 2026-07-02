'use client';

import { useEffect, useState } from 'react';
import type { PublicNetwork } from '../../api/types';
import { formatDateTime } from '../../format/formatters';

const fallbackRefreshIntervalMs = 10_000;
const liveNetworkPath = '/v1/live';

async function fetchNetwork(signal: AbortSignal): Promise<PublicNetwork> {
	const response = await fetch(buildClientApiUrl('/v1', true), {
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		signal
	});

	if (!response.ok)
		throw new Error(`Network request returned ${response.status}`);
	return response.json() as Promise<PublicNetwork>;
}

const getClientApiBaseUrl = (): string => {
	const configuredUrl = process.env.NEXT_PUBLIC_STELLAR_ATLAS_API_URL?.trim();
	if (configuredUrl && configuredUrl.length > 0)
		return configuredUrl.endsWith('/')
			? configuredUrl.slice(0, -1)
			: configuredUrl;

	if (
		window.location.hostname === 'stellaratlas.io' ||
		window.location.hostname.endsWith('.stellaratlas.io')
	) {
		return 'https://api.stellaratlas.io';
	}

	return window.location.origin;
};

const buildClientApiUrl = (path: string, cacheBust = false): string => {
	const url = new URL(path, getClientApiBaseUrl());
	if (cacheBust) url.searchParams.set('refresh', Date.now().toString());
	return url.toString();
};

export function NetworkStrip(): React.JSX.Element {
	const [network, setNetwork] = useState<PublicNetwork | null>(null);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadNetwork = (): void => {
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchNetwork(abortController.signal)
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

		const eventSource = new EventSource(buildClientApiUrl(liveNetworkPath, true));
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
