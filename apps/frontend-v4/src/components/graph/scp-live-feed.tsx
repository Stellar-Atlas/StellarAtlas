'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
	PublicLedgerTransaction,
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import { fetchBrowserLedgerTransactions } from '../../api/browser-client';
import {
	compareLedgerSequences,
	getHighestLedgerSequence,
	toLedgerSequenceText
} from '../../domain/ledger-sequence';
import { getNodeLabel } from '../../domain/network';

interface ScpLiveFeedProps {
	activeStatements: readonly PublicScpStatementObservation[];
	network: PublicNetwork;
	statements: readonly PublicScpStatementObservation[];
}

interface StatementSummary {
	confirm: number;
	externalize: number;
	nominate: number;
	organizationCount: number;
	prepare: number;
	signerCount: number;
	slotIndex: string;
	txSetHash: string | null;
}

interface TransactionSetState {
	message: string | null;
	records: readonly PublicLedgerTransaction[];
	slotIndex: string | null;
	status: 'idle' | 'loading' | 'loaded' | 'error';
}

interface SelectedTransactionSet {
	slotIndex: string;
	txSetHash: string | null;
}

const getStatementNodeLabel = (
	network: PublicNetwork,
	statement: PublicScpStatementObservation
): string => {
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === statement.nodeId
	);
	return node ? getNodeLabel(node) : statement.nodeId.slice(0, 12);
};

export const getStatementValueHash = (
	statement: PublicScpStatementObservation
): string => {
	const value = statement.values[0];
	if (value !== undefined) return value.txSetHash.slice(0, 12);

	return statement.statementHash.slice(0, 12);
};

const getStatementValueLabel = (
	statement: PublicScpStatementObservation
): string => (statement.values[0] === undefined ? 'statement hash' : 'tx set');

const formatStatementAge = (
	statement: PublicScpStatementObservation
): string => {
	const observedAt = new Date(statement.observedAt).getTime();
	const ageSeconds = Math.max(0, Math.floor((Date.now() - observedAt) / 1000));
	if (ageSeconds < 90) return `${ageSeconds}s`;
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 90) return `${ageMinutes}m`;
	return `${Math.floor(ageMinutes / 60)}h`;
};

const summarizeStatements = (
	network: PublicNetwork,
	statements: readonly PublicScpStatementObservation[]
): StatementSummary | null => {
	const latestSlotIndex = getHighestLedgerSequence(
		statements.map((statement) => statement.slotIndex)
	);
	if (latestSlotIndex === null) return null;

	const slotStatements = statements.filter(
		(statement) => statement.slotIndex === latestSlotIndex
	);
	const slotSigners = new Set(
		slotStatements.map((statement) => statement.nodeId)
	);
	const slotOrganizations = new Set(
		slotStatements.map((statement) => {
			const node = network.nodes.find(
				(candidate) => candidate.publicKey === statement.nodeId
			);
			return node?.organizationId ?? node?.homeDomain ?? statement.nodeId;
		})
	);
	const summary: StatementSummary = {
		confirm: 0,
		externalize: 0,
		nominate: 0,
		organizationCount: slotOrganizations.size,
		prepare: 0,
		signerCount: slotSigners.size,
		slotIndex: latestSlotIndex,
		txSetHash:
			slotStatements.find((statement) => statement.values[0] !== undefined)
				?.values[0]?.txSetHash ?? null
	};

	for (const statement of slotStatements) {
		if (statement.statementType === 'confirm') summary.confirm += 1;
		if (statement.statementType === 'externalize') summary.externalize += 1;
		if (statement.statementType === 'nominate') summary.nominate += 1;
		if (statement.statementType === 'prepare') summary.prepare += 1;
	}

	return summary;
};

const compareStatementsForFeed = (
	left: PublicScpStatementObservation,
	right: PublicScpStatementObservation
): number => {
	const slotComparison = compareLedgerSequences(
		right.slotIndex,
		left.slotIndex
	);
	if (slotComparison !== 0) return slotComparison;

	const observedComparison =
		new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime();
	if (observedComparison !== 0) return observedComparison;

	return right.statementHash.localeCompare(left.statementHash);
};

const getStellarExpertTransactionUrl = (hash: string): string =>
	`https://stellar.expert/explorer/public/tx/${encodeURIComponent(hash)}`;
const visibleStatementCount = 12;

const shortenHash = (hash: string): string =>
	hash.length > 18 ? `${hash.slice(0, 12)}...${hash.slice(-6)}` : hash;

const getStatementTransactionSet = (
	statement: PublicScpStatementObservation
): SelectedTransactionSet => ({
	slotIndex: statement.slotIndex,
	txSetHash: statement.values[0]?.txSetHash ?? null
});

export function ScpLiveFeed({
	activeStatements,
	network,
	statements
}: ScpLiveFeedProps): React.JSX.Element {
	const summary = summarizeStatements(network, statements);
	const currentLedgerSlot =
		toLedgerSequenceText(network.latestLedger) ??
		network.latestLedger.toString();
	const currentLedgerTransactionSet: SelectedTransactionSet = {
		slotIndex: currentLedgerSlot,
		txSetHash:
			summary?.slotIndex === currentLedgerSlot ? summary.txSetHash : null
	};
	const recentStatements = useMemo(
		() => statements.toSorted(compareStatementsForFeed).slice(0, 48),
		[statements]
	);
	const [feedOffset, setFeedOffset] = useState(0);
	const [selectedTransactionSet, setSelectedTransactionSet] =
		useState<SelectedTransactionSet | null>(null);
	const [transactionSetState, setTransactionSetState] =
		useState<TransactionSetState>({
			message: null,
			records: [],
			slotIndex: null,
			status: 'idle'
		});
	const transactionSetStatus = useMemo(() => {
		if (!selectedTransactionSet) return null;
		if (transactionSetState.slotIndex !== selectedTransactionSet.slotIndex)
			return null;
		return transactionSetState;
	}, [selectedTransactionSet, transactionSetState]);

	const openTransactionSet = (transactionSet: SelectedTransactionSet): void => {
		setSelectedTransactionSet(transactionSet);
	};

	const closeTransactionSet = (): void => {
		setSelectedTransactionSet(null);
	};

	useEffect(() => {
		if (!selectedTransactionSet) return;
		const abortController = new AbortController();
		setTransactionSetState({
			message: null,
			records: [],
			slotIndex: selectedTransactionSet.slotIndex,
			status: 'loading'
		});

		void fetchBrowserLedgerTransactions(
			selectedTransactionSet.slotIndex,
			abortController.signal
		)
			.then((payload) => {
				setTransactionSetState({
					message: payload.truncated
						? `Showing the first ${payload.records.length} ledger transactions.`
						: null,
					records: payload.records,
					slotIndex: selectedTransactionSet.slotIndex,
					status: 'loaded'
				});
			})
			.catch((error: Error) => {
				if (abortController.signal.aborted) return;
				setTransactionSetState({
					message: error.message,
					records: [],
					slotIndex: selectedTransactionSet.slotIndex,
					status: 'error'
				});
			});

		return () => abortController.abort();
	}, [selectedTransactionSet]);

	useEffect(() => {
		setFeedOffset(0);
	}, [recentStatements[0]?.statementHash]);

	useEffect(() => {
		if (recentStatements.length <= visibleStatementCount) return;
		const interval = window.setInterval(() => {
			setFeedOffset((current) => (current + 1) % recentStatements.length);
		}, 650);

		return () => window.clearInterval(interval);
	}, [recentStatements.length]);

	useEffect(() => {
		if (!selectedTransactionSet) return;
		const closeOnEscape = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') closeTransactionSet();
		};
		window.addEventListener('keydown', closeOnEscape);
		return () => window.removeEventListener('keydown', closeOnEscape);
	}, [selectedTransactionSet]);

	const visibleStatements = useMemo(() => {
		if (recentStatements.length <= visibleStatementCount)
			return recentStatements;
		return Array.from({ length: visibleStatementCount }, (_, index) => {
			const nextIndex = (feedOffset + index) % recentStatements.length;
			return recentStatements[nextIndex];
		}).filter(
			(statement): statement is PublicScpStatementObservation =>
				statement !== undefined
		);
	}, [feedOffset, recentStatements]);

	return (
		<section className="scp-live-feed" aria-label="SCP live feed">
			<div className="scp-live-heading">
				<h2>SCP live feed</h2>
				<span>{statements.length > 0 ? 'observed' : 'collecting'}</span>
			</div>
			<div className="scp-packet-legend" aria-label="SCP packet color legend">
				<span className="nominate">Nominate</span>
				<span className="prepare">Prepare</span>
				<span className="confirm">Confirm</span>
				<span className="externalize">Externalize</span>
			</div>
			{activeStatements.length > 0 && (
				<div className="scp-flow-focus-grid">
					{activeStatements.map((statement) => (
						<div className="scp-flow-focus" key={statement.statementHash}>
							<span className={`flow-pulse ${statement.statementType}`} />
							<div>
								<strong>{getStatementNodeLabel(network, statement)}</strong>
								<span>
									{statement.statementType} / slot {statement.slotIndex}
								</span>
							</div>
							<code>
								<span>{getStatementValueLabel(statement)}</span>
								{getStatementValueHash(statement)}
							</code>
						</div>
					))}
				</div>
			)}
			{summary && (
				<div className="scp-slot-summary">
					<button
						className="ledger-slot-button"
						onClick={() => openTransactionSet(currentLedgerTransactionSet)}
						type="button"
					>
						<span>Ledger slot</span>
						<strong>{currentLedgerSlot}</strong>
					</button>
					<button
						className="tx-set-button"
						onClick={() =>
							openTransactionSet({
								slotIndex: currentLedgerSlot,
								txSetHash: summary.txSetHash
							})
						}
						type="button"
					>
						<span>Transaction set</span>
						<code>{summary.txSetHash?.slice(0, 18) ?? 'pending'}</code>
					</button>
					<div>
						<span>Nominations</span>
						<strong>{summary.nominate}</strong>
					</div>
					<div>
						<span>Votes</span>
						<strong>
							{summary.prepare + summary.confirm + summary.externalize}
						</strong>
					</div>
					<div>
						<span>Observed signers</span>
						<strong>{summary.signerCount}</strong>
					</div>
					<div>
						<span>Observed orgs</span>
						<strong>{summary.organizationCount}</strong>
					</div>
				</div>
			)}
			{selectedTransactionSet && (
				<div
					className="tx-set-modal-backdrop"
					onClick={closeTransactionSet}
					role="presentation"
				>
					<article
						aria-label={`Transaction set for ledger ${selectedTransactionSet.slotIndex}`}
						aria-modal="true"
						className="tx-set-modal"
						onClick={(event) => event.stopPropagation()}
						role="dialog"
					>
						<div className="tx-set-panel-heading">
							<div>
								<strong>Ledger {selectedTransactionSet.slotIndex}</strong>
								<code>
									{selectedTransactionSet.txSetHash ??
										'pending transaction set'}
								</code>
							</div>
							<button
								aria-label="Close transaction set"
								onClick={closeTransactionSet}
								type="button"
							>
								&times;
							</button>
						</div>
						{transactionSetStatus?.status === 'loading' && (
							<p>Loading ledger transactions...</p>
						)}
						{transactionSetStatus?.status === 'error' && (
							<p>
								{transactionSetStatus.message ?? 'Transaction set unavailable.'}
							</p>
						)}
						{transactionSetStatus?.status === 'loaded' && (
							<div className="tx-set-records">
								{transactionSetStatus.message && (
									<p>{transactionSetStatus.message}</p>
								)}
								{transactionSetStatus.records.length === 0 && (
									<p>No transactions were returned for this ledger.</p>
								)}
								{transactionSetStatus.records.map((record) => (
									<a
										href={getStellarExpertTransactionUrl(record.hash)}
										key={record.hash}
										rel="noreferrer"
										target="_blank"
									>
										<code>{shortenHash(record.hash)}</code>
										<span>{record.operationCount} ops</span>
										<span>{record.successful ? 'success' : 'failed'}</span>
									</a>
								))}
							</div>
						)}
					</article>
				</div>
			)}
			<div className="scp-flow-list">
				{visibleStatements.map((statement) => (
					<button
						className={
							activeStatements.some(
								(activeStatement) =>
									activeStatement.statementHash === statement.statementHash
							)
								? 'active'
								: ''
						}
						key={statement.statementHash}
						onClick={() =>
							openTransactionSet(getStatementTransactionSet(statement))
						}
						type="button"
					>
						<span suppressHydrationWarning>
							{formatStatementAge(statement)}
						</span>
						<strong>{getStatementNodeLabel(network, statement)}</strong>
						<small>{statement.statementType}</small>
					</button>
				))}
				{recentStatements.length === 0 && (
					<p>Waiting for new crawler observations after deployment.</p>
				)}
			</div>
		</section>
	);
}
