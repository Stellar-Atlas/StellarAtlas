'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
	PublicLedgerTransaction,
	PublicNetwork,
	PublicScpGraphStatement,
	PublicScpStatementReadMetadata
} from '../../api/types';
import { getLedgerTransactions } from '../../app/actions/network-data';
import {
	compareLedgerSequences,
	getHighestLedgerSequence,
	toLedgerSequenceText
} from '../../domain/ledger-sequence';
import { getNodeLabel } from '../../domain/network';
import { ScpPhaseTimeline } from './scp-phase-timeline';
import {
	formatScpReadMetadataLabel,
	formatScpReadMetadataTitle
} from './scp-read-metadata';

interface ScpLiveFeedProps {
	activeSlotIndex: string | null;
	activeStatements: readonly PublicScpGraphStatement[];
	latestLedgerSlotIndex: string | null;
	network: PublicNetwork;
	observedSlotIndex: string | null;
	readMetadata: PublicScpStatementReadMetadata | null;
	statements: readonly PublicScpGraphStatement[];
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
	statement: PublicScpGraphStatement
): string => {
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === statement.nodeId
	);
	return node ? getNodeLabel(node) : statement.nodeId.slice(0, 12);
};

export const getStatementValueHash = (
	statement: PublicScpGraphStatement
): string => {
	const value = statement.values[0];
	if (value !== undefined) return value.txSetHash.slice(0, 12);

	return statement.statementHash.slice(0, 12);
};

const summarizeStatements = (
	network: PublicNetwork,
	statements: readonly PublicScpGraphStatement[]
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
	left: PublicScpGraphStatement,
	right: PublicScpGraphStatement
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
	statement: PublicScpGraphStatement
): SelectedTransactionSet => ({
	slotIndex: statement.slotIndex,
	txSetHash: statement.values[0]?.txSetHash ?? null
});

export function ScpLiveFeed({
	activeSlotIndex,
	activeStatements,
	latestLedgerSlotIndex,
	network,
	observedSlotIndex,
	readMetadata,
	statements
}: ScpLiveFeedProps): React.JSX.Element {
	const summary = useMemo(
		() => summarizeStatements(network, statements),
		[network, statements]
	);
	const latestLedgerText =
		latestLedgerSlotIndex ??
		toLedgerSequenceText(network.latestLedger) ??
		network.latestLedger.toString();
	const observedSlotText = observedSlotIndex ?? summary?.slotIndex ?? null;
	const activeSlotHasRows =
		activeSlotIndex !== null &&
		statements.some((statement) => statement.slotIndex === activeSlotIndex);
	const visibleActiveSlotIndex = activeSlotHasRows ? activeSlotIndex : null;
	const feedSlotIndex =
		visibleActiveSlotIndex ??
		summary?.slotIndex ??
		observedSlotText ??
		latestLedgerText;
	const timelineSlotIndex =
		visibleActiveSlotIndex ??
		observedSlotText ??
		summary?.slotIndex ??
		latestLedgerText;
	const recentStatements = useMemo(
		() =>
			statements
				.filter((statement) => statement.slotIndex === feedSlotIndex)
				.toSorted(compareStatementsForFeed)
				.slice(0, 48),
		[feedSlotIndex, statements]
	);
	const activeStatementHashSet = useMemo(
		() => new Set(activeStatements.map((statement) => statement.statementHash)),
		[activeStatements]
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
		let cancelled = false;
		setTransactionSetState({
			message: null,
			records: [],
			slotIndex: selectedTransactionSet.slotIndex,
			status: 'loading'
		});

		void getLedgerTransactions(selectedTransactionSet.slotIndex)
			.then((payload) => {
				if (cancelled) return;
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
				if (cancelled) return;
				setTransactionSetState({
					message: error.message,
					records: [],
					slotIndex: selectedTransactionSet.slotIndex,
					status: 'error'
				});
			});

		return () => {
			cancelled = true;
		};
	}, [selectedTransactionSet]);

	useEffect(() => {
		setFeedOffset(0);
	}, [feedSlotIndex]);

	const maxFeedOffset = Math.max(
		0,
		recentStatements.length - visibleStatementCount
	);

	useEffect(() => {
		setFeedOffset((current) => Math.min(current, maxFeedOffset));
	}, [maxFeedOffset]);

	useEffect(() => {
		if (feedOffset >= maxFeedOffset) return;
		const interval = window.setInterval(() => {
			setFeedOffset((current) => Math.min(current + 1, maxFeedOffset));
		}, 650);

		return () => window.clearInterval(interval);
	}, [feedOffset, maxFeedOffset]);

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
		return recentStatements.slice(
			feedOffset,
			feedOffset + visibleStatementCount
		);
	}, [feedOffset, recentStatements]);

	return (
		<section className="scp-live-feed" aria-label="SCP live feed">
			<div className="scp-live-heading">
				<h2>SCP live feed</h2>
				<span
					data-freshness={readMetadata?.freshness ?? 'connecting'}
					data-source={readMetadata?.source ?? 'not_connected'}
					title={formatScpReadMetadataTitle(readMetadata)}
				>
					{formatScpReadMetadataLabel(readMetadata)}
				</span>
			</div>
			<div className="scp-packet-legend" aria-label="SCP packet color legend">
				<span className="nominate">Nominate</span>
				<span className="prepare">Prepare</span>
				<span className="confirm">Confirm</span>
				<span className="externalize">Externalize</span>
			</div>
			<ScpPhaseTimeline
				activeSlotIndex={visibleActiveSlotIndex}
				activeStatements={activeStatements}
				fallbackSlotIndex={timelineSlotIndex}
				focusedStatement={null}
				network={network}
				statements={statements}
			/>
			{summary && (
				<div className="scp-slot-summary">
					<div
						aria-label={`Animating SCP slot ${activeSlotIndex ?? 'waiting'}`}
						className="scp-clock-card"
						role="status"
					>
						<span>Animating</span>
						<strong>{activeSlotIndex ?? 'waiting'}</strong>
					</div>
					<div
						aria-label={`Observed SCP slot ${observedSlotText ?? 'collecting'}`}
						className="scp-clock-card"
						role="status"
					>
						<span>Observed SCP</span>
						<strong>{observedSlotText ?? 'collecting'}</strong>
					</div>
					<div
						aria-label={`Latest ledger ${latestLedgerText}`}
						className="scp-clock-card"
						role="status"
					>
						<span>Latest ledger</span>
						<strong>{latestLedgerText}</strong>
					</div>
					<button
						className="tx-set-button"
						onClick={() =>
							openTransactionSet({
								slotIndex: summary.slotIndex,
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
							activeStatementHashSet.has(statement.statementHash)
								? 'active'
								: ''
						}
						key={statement.statementHash}
						onClick={() =>
							openTransactionSet(getStatementTransactionSet(statement))
						}
						type="button"
					>
						<span className="scp-flow-slot">{statement.slotIndex}</span>
						<strong>{getStatementNodeLabel(network, statement)}</strong>
						<small>{statement.statementType}</small>
					</button>
				))}
				{recentStatements.length === 0 && (
					<p>Waiting for SCP observations for this slot.</p>
				)}
			</div>
		</section>
	);
}
