import { useEffect, useState } from 'react';
import type {
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import {
	publishLatestLedger,
	subscribeToLatestLedger
} from '../../api/latest-ledger-events';
import { getHighestLedgerSequence } from '../../domain/ledger-sequence';
import { subscribeToLiveNetworkStream } from '../../api/live-network-stream';

const scpStatementFetchLimit = 1_000;

const getNewerLedger = (current: string | null, next: unknown): string | null =>
	getHighestLedgerSequence([current, next]) ?? current;

const compareStatementsNewestFirst = (
	left: PublicScpStatementObservation,
	right: PublicScpStatementObservation
): number =>
	new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime() ||
	right.statementHash.localeCompare(left.statementHash);

const mergeScpStatements = (
	current: readonly PublicScpStatementObservation[],
	next: readonly PublicScpStatementObservation[]
): PublicScpStatementObservation[] => {
	const byHash = new Map(
		current.map((statement) => [statement.statementHash, statement])
	);
	for (const statement of next) byHash.set(statement.statementHash, statement);
	return Array.from(byHash.values())
		.toSorted(compareStatementsNewestFirst)
		.slice(0, scpStatementFetchLimit);
};

interface UseGraphLiveDataResult {
	latestLedger: string | null;
	latestLedgerClosedAt: string | null;
	latestObservedScpSlotIndex: string | null;
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
	const [latestLedgerClosedAt, setLatestLedgerClosedAt] = useState<
		string | null
	>(null);
	const latestObservedScpSlotIndex =
		getHighestLedgerSequence(
			scpStatements.map((statement) => statement.slotIndex)
		);

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
				if (message.type === 'scp' && message.payload.length > 0) {
					setScpStatements((current) =>
						mergeScpStatements(current, message.payload)
					);
				}
			}),
		[]
	);

	return {
		latestLedger,
		latestLedgerClosedAt,
		latestObservedScpSlotIndex,
		network,
		scpStatements
	};
};
