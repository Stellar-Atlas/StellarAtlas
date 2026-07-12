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
import { subscribeToLiveNetworkStream } from '../../api/live-network-stream';
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
	network: PublicNetwork;
	scpReadMetadata: PublicScpStatementReadMetadata | null;
	scpStatements: PublicScpGraphStatement[];
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

	useEffect(
		() =>
			subscribeToLiveNetworkStream((message) => {
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
				if (message.type === 'scp') {
					setScpState((current) => applyLiveScpMessage(current, message));
				}
			}),
		[]
	);

	return {
		latestLedger,
		latestLedgerClosedAt,
		latestObservedScpSlotIndex,
		network,
		scpReadMetadata: scpState.metadata,
		scpStatements: scpState.statements
	};
};
