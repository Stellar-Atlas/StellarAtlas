import { useEffect, useState } from 'react';
import type {
	PublicNetwork,
	PublicScpGraphStatement,
	PublicScpStatementReadMetadata
} from '../../api/types';
import {
	publishLatestLedger,
	subscribeToLatestLedger
} from '../../api/latest-ledger-events';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import {
	getLiveNetworkStreamState,
	subscribeToLiveNetworkStream,
	type LiveNetworkStreamState
} from '../../api/live-network-stream';
import {
	applyLiveScpMessage,
	createLiveScpConsumerState
} from '../../api/live-scp-consumer-state';

const getNewerLedger = (current: string | null, next: unknown): string | null =>
	getHighestLedgerSequence([current, next]) ?? current;

interface UseGraphLiveDataResult {
	latestLedger: string | null;
	latestLedgerClosedAt: string | null;
	latestObservedScpSlotIndex: string | null;
	liveStreamState: LiveNetworkStreamState;
	network: PublicNetwork;
	scpReadMetadata: PublicScpStatementReadMetadata | null;
	scpStatements: PublicScpGraphStatement[];
	liveEnabled: boolean;
	setLiveEnabled: (enabled: boolean) => void;
}

export const useGraphLiveData = (
	initialNetwork: PublicNetwork,
	initialScpStatements: PublicScpGraphStatement[]
): UseGraphLiveDataResult => {
	const [network, setNetwork] = useState(initialNetwork);
	const [scpState, setScpState] = useState(() =>
		createLiveScpConsumerState(initialScpStatements)
	);
	const [latestLedger, setLatestLedger] = useState<string | null>(null);
	const [latestLedgerClosedAt, setLatestLedgerClosedAt] = useState<
		string | null
	>(null);
	const [liveStreamState, setLiveStreamState] = useState(
		getLiveNetworkStreamState
	);
	const [liveEnabled, setLiveEnabled] = useState(true);
	const latestObservedScpSlotIndex = getHighestLedgerSequence(
		scpState.statements.map((statement) => statement.slotIndex)
	);

	useEffect(() => {
		setNetwork(initialNetwork);
	}, [initialNetwork]);

	useEffect(() => {
		setScpState((current) => ({
			...current,
			statements: [...initialScpStatements]
		}));
	}, [initialScpStatements]);

	useEffect(
		() =>
			subscribeToLatestLedger((sequence) => {
				setLatestLedger((current) => getNewerLedger(current, sequence));
			}),
		[]
	);

	useEffect(() => {
		if (!liveEnabled) return;
		return subscribeToLiveNetworkStream(
			(message) => {
				if (message.type === 'network') {
					setNetwork(message.payload);
					publishLatestLedger(message.payload.latestLedger);
					setLatestLedger((current) =>
						getNewerLedger(current, message.payload.latestLedger)
					);
				}
				if (message.type === 'latestLedger') {
					publishLatestLedger(message.payload.sequence);
					setLatestLedgerClosedAt(message.payload.closedAt);
					setLatestLedger((current) =>
						getNewerLedger(current, message.payload.sequence)
					);
				}
				if (message.type === 'scpGraph' || message.type === 'scp') {
					setScpState((current) => applyLiveScpMessage(current, message));
					const highestLedger = getHighestLedgerSequence(
						message.payload.map((statement) => statement.slotIndex)
					);
					if (highestLedger) {
						publishLatestLedger(highestLedger);
						setLatestLedger((current) =>
							getNewerLedger(current, highestLedger)
						);
					}
				}
			},
			setLiveStreamState,
			{ channels: ['network', 'scp'], scpMode: 'graph' }
		);
	}, [liveEnabled]);

	return {
		latestLedger,
		latestLedgerClosedAt,
		latestObservedScpSlotIndex,
		liveStreamState,
		network,
		scpReadMetadata: scpState.metadata,
		scpStatements: scpState.statements,
		liveEnabled,
		setLiveEnabled
	};
};
