'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
	PublicLedgerTransaction,
	PublicNetwork,
	PublicScpStatementObservation
} from '../../api/types';
import { fetchBrowserLedgerTransactions } from '../../api/browser-client';
import { getNodeLabel } from '../../domain/network';

interface ScpLiveFeedProps {
	activeStatement: PublicScpStatementObservation | null;
	network: PublicNetwork;
	statements: PublicScpStatementObservation[];
}

interface StatementSummary {
	confirm: number;
	externalize: number;
	nominate: number;
	prepare: number;
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
	const node = network.nodes.find((candidate) => candidate.publicKey === statement.nodeId);
	return node ? getNodeLabel(node) : statement.nodeId.slice(0, 12);
};

export const getStatementValueHash = (
	statement: PublicScpStatementObservation
): string => {
	const value = statement.values[0];
	if (value !== undefined) return value.txSetHash.slice(0, 12);

	return statement.statementHash.slice(0, 12);
};

const formatStatementAge = (statement: PublicScpStatementObservation): string => {
	const observedAt = new Date(statement.observedAt).getTime();
	const ageSeconds = Math.max(0, Math.floor((Date.now() - observedAt) / 1000));
	if (ageSeconds < 90) return `${ageSeconds}s`;
	const ageMinutes = Math.floor(ageSeconds / 60);
	if (ageMinutes < 90) return `${ageMinutes}m`;
	return `${Math.floor(ageMinutes / 60)}h`;
};

const summarizeStatements = (
	statements: PublicScpStatementObservation[]
): StatementSummary | null => {
	const firstStatement = statements[0];
	if (!firstStatement) return null;

	const slotStatements = statements.filter(
		(statement) => statement.slotIndex === firstStatement.slotIndex
	);
	const summary: StatementSummary = {
		confirm: 0,
		externalize: 0,
		nominate: 0,
		prepare: 0,
		slotIndex: firstStatement.slotIndex,
		txSetHash: firstStatement.values[0]?.txSetHash ?? null
	};

	for (const statement of slotStatements) {
		if (statement.statementType === 'confirm') summary.confirm += 1;
		if (statement.statementType === 'externalize') summary.externalize += 1;
		if (statement.statementType === 'nominate') summary.nominate += 1;
		if (statement.statementType === 'prepare') summary.prepare += 1;
	}

	return summary;
};

const getStellarExpertTransactionUrl = (hash: string): string =>
	`https://stellar.expert/explorer/public/tx/${encodeURIComponent(hash)}`;

const shortenHash = (hash: string): string =>
	hash.length > 18 ? `${hash.slice(0, 12)}...${hash.slice(-6)}` : hash;

const getStatementTransactionSet = (
	statement: PublicScpStatementObservation
): SelectedTransactionSet => ({
	slotIndex: statement.slotIndex,
	txSetHash: statement.values[0]?.txSetHash ?? null
});

export function ScpLiveFeed({
	activeStatement,
	network,
	statements
}: ScpLiveFeedProps): React.JSX.Element {
	const summary = summarizeStatements(statements);
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
					message:
						payload.truncated
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
		if (!selectedTransactionSet) return;
		const closeOnEscape = (event: KeyboardEvent): void => {
			if (event.key === 'Escape') closeTransactionSet();
		};
		window.addEventListener('keydown', closeOnEscape);
		return () => window.removeEventListener('keydown', closeOnEscape);
	}, [selectedTransactionSet]);

	return (
		<section className="scp-live-feed" aria-label="SCP live feed">
			<div className="scp-live-heading">
				<h2>SCP live feed</h2>
				<span>{statements.length > 0 ? 'observed' : 'collecting'}</span>
			</div>
			<div className="scp-packet-legend" aria-label="SCP packet color legend">
				<span className="nominate">Nominate</span>
				<span className="prepare">Vote</span>
				<span className="confirm">Confirm</span>
				<span className="externalize">Externalize</span>
			</div>
			{activeStatement && (
				<div className="scp-flow-focus">
					<span className="flow-pulse" />
					<div>
						<strong>{getStatementNodeLabel(network, activeStatement)}</strong>
						<span>
							{activeStatement.statementType} / slot {activeStatement.slotIndex}
						</span>
					</div>
					<code>{getStatementValueHash(activeStatement)}</code>
				</div>
			)}
			{summary && (
				<div className="scp-slot-summary">
					<div>
						<span>Ledger slot</span>
						<strong>{summary.slotIndex}</strong>
					</div>
					<button
						className="tx-set-button"
						disabled={!summary.txSetHash}
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
									{selectedTransactionSet.txSetHash ?? 'pending transaction set'}
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
							<p>{transactionSetStatus.message ?? 'Transaction set unavailable.'}</p>
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
				{statements.map((statement) => (
					<button
						className={
							statement.statementHash === activeStatement?.statementHash
								? 'active'
								: ''
						}
						key={statement.statementHash}
						onClick={() => openTransactionSet(getStatementTransactionSet(statement))}
						type="button"
					>
						<span suppressHydrationWarning>
							{formatStatementAge(statement)}
						</span>
						<strong>{getStatementNodeLabel(network, statement)}</strong>
						<small>
							{statement.statementType} / slot {statement.slotIndex}
						</small>
					</button>
				))}
				{statements.length === 0 && (
					<p>Waiting for new crawler observations after deployment.</p>
				)}
			</div>
		</section>
	);
}
