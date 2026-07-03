import { useEffect, useState } from 'react';
import type {
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import {
	buildBrowserApiUrl,
	fetchBrowserLatestLedger,
	fetchBrowserPublicNetwork,
	fetchBrowserScpStatements
} from '../../api/browser-client';
import {
	publishLatestLedger,
	subscribeToLatestLedger
} from '../../api/latest-ledger-events';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';

const networkRefreshIntervalMs = 10_000;
const scpRefreshIntervalMs = 1_200;
const latestLedgerRefreshIntervalMs = 2_000;
const liveNetworkPath = '/v1/live';
const liveScpStatementPath = '/v1/scp-statements/live';

const getNewerLedger = (current: string | null, next: unknown): string | null =>
	getHighestLedgerSequence([current, next]) ?? current;

interface UseGraphLiveDataResult {
	latestLedger: string | null;
	network: PublicNetwork;
	scpStatements: PublicScpStatementObservation[];
}

export const useGraphLiveData = (
	initialNetwork: PublicNetwork,
	initialScpStatements: PublicScpStatementObservation[]
): UseGraphLiveDataResult => {
	const [network, setNetwork] = useState(initialNetwork);
	const [scpStatements, setScpStatements] = useState(initialScpStatements);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);

	useEffect(() => {
		setNetwork(initialNetwork);
	}, [initialNetwork]);

	useEffect(() => {
		setScpStatements(initialScpStatements);
	}, [initialScpStatements]);

	useEffect(
		() =>
			subscribeToLatestLedger((sequence) => {
				setLatestLedger((current) => getNewerLedger(current, sequence));
			}),
		[]
	);

	useEffect(() => {
		let isMounted = true;
		const pendingRequests = new Set<AbortController>();

		const loadNetwork = (): void => {
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserPublicNetwork(abortController.signal)
				.then((nextNetwork) => {
					if (isMounted) setNetwork(nextNetwork);
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		loadNetwork();
		const interval = window.setInterval(loadNetwork, networkRefreshIntervalMs);
		const eventSource = new EventSource(
			buildBrowserApiUrl(liveNetworkPath, true)
		);
		eventSource.addEventListener('network', (event) => {
			if (!isMounted) return;
			try {
				setNetwork(JSON.parse(event.data) as PublicNetwork);
			} catch {
				loadNetwork();
			}
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
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserLatestLedger(abortController.signal)
				.then((ledger) => {
					if (!isMounted) return;
					publishLatestLedger(ledger.sequence);
					setLatestLedger((current) =>
						getNewerLedger(current, ledger.sequence)
					);
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
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

		const loadStatements = (): void => {
			if (pendingRequests.size > 0) return;
			const abortController = new AbortController();
			pendingRequests.add(abortController);
			void fetchBrowserScpStatements({ limit: 160 }, abortController.signal)
				.then((nextStatements) => {
					if (isMounted && nextStatements.length > 0) {
						setScpStatements(nextStatements);
					}
				})
				.catch(() => undefined)
				.finally(() => pendingRequests.delete(abortController));
		};

		loadStatements();
		const interval = window.setInterval(loadStatements, scpRefreshIntervalMs);
		const eventSource = new EventSource(
			buildBrowserApiUrl(liveScpStatementPath, true)
		);
		eventSource.addEventListener('scp', (event) => {
			if (!isMounted) return;
			try {
				const nextStatements = JSON.parse(
					event.data
				) as PublicScpStatementObservation[];
				if (nextStatements.length > 0) setScpStatements(nextStatements);
			} catch {
				loadStatements();
			}
		});
		eventSource.onerror = () => {
			loadStatements();
		};

		return () => {
			isMounted = false;
			eventSource.close();
			for (const request of pendingRequests) request.abort();
			window.clearInterval(interval);
		};
	}, []);

	return { latestLedger, network, scpStatements };
};
