'use client';
import { useEffect, useReducer, useState } from 'react';
import { entityText, type ExplorerFilters } from '../../api/explorer-analytics';
import {
	contractActivityPath,
	requestContractActivity,
	type ContractActivityTab
} from '../../api/explorer-contract-activity';
import { LocalDateTime } from '../local-date-time';
import { ExplorerContractRecord } from './explorer-contract-record';
import {
	contractActivityReducer,
	initialContractActivityState,
	type ContractActivityState
} from './explorer-contract-activity-model';
import styles from './explorer-entity.module.css';

export function ExplorerContractActivity({
	contractId,
	filters
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const [tab, setTab] = useState<ContractActivityTab>('events');
	return (
		<section className={styles.panel} aria-label="Contract activity">
			<div className={styles.actions}>
				<button
					aria-pressed={tab === 'events'}
					onClick={() => setTab('events')}
				>
					Events
				</button>
				<button aria-pressed={tab === 'state'} onClick={() => setTab('state')}>
					State changes
				</button>
			</div>
			<p className={styles.muted}>
				{tab === 'events'
					? 'Typed decoded event topics and payloads, with recorded provenance and transaction links.'
					: 'Recorded key/value changes. This is historical evidence, not a complete current-state snapshot.'}
			</p>
			<ContractActivityResults
				key={contractActivityPath(contractId, tab, filters)}
				contractId={contractId}
				filters={filters}
				tab={tab}
			/>
		</section>
	);
}

function ContractActivityResults({
	contractId,
	filters,
	tab
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
	readonly tab: ContractActivityTab;
}): React.JSX.Element {
	const [state, dispatch] = useReducer(
		contractActivityReducer,
		initialContractActivityState
	);
	const { requestId, requestedPosition } = state;
	const path = contractActivityPath(
		contractId,
		tab,
		filters,
		requestedPosition
	);
	useEffect(() => {
		let disposed = false;
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), 25000);
		void requestContractActivity(
			path,
			contractId,
			tab,
			requestedPosition,
			abort.signal
		)
			.then((page) => {
				if (!disposed) dispatch({ type: 'loaded', requestId, page });
			})
			.catch((failure: unknown) => {
				if (!disposed)
					dispatch({
						type: 'failed',
						requestId,
						error: abort.signal.aborted
							? 'Contract query timed out. Narrow the ledger range or retry.'
							: failure instanceof Error
								? failure.message
								: 'Contract data unavailable.'
					});
			})
			.finally(() => clearTimeout(timeout));
		return () => {
			disposed = true;
			clearTimeout(timeout);
			abort.abort();
		};
	}, [path, contractId, tab, requestedPosition, requestId]);
	return (
		<ContractActivityView
			state={state}
			tab={tab}
			onRetry={() => dispatch({ type: 'retry' })}
			onPrevious={() => dispatch({ type: 'previous' })}
			onNext={() => dispatch({ type: 'next' })}
			onRefresh={() => dispatch({ type: 'refresh' })}
		/>
	);
}

export function ContractActivityView({
	state,
	tab,
	onRetry,
	onPrevious,
	onNext,
	onRefresh
}: {
	readonly state: ContractActivityState;
	readonly tab: ContractActivityTab;
	readonly onRetry: () => void;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onRefresh: () => void;
}): React.JSX.Element {
	const page = state.page;
	const minimum = page ? entityText(page.watermark, 'minimumLedger') : '';
	const maximum = page ? entityText(page.watermark, 'maximumLedger') : '';
	const observedAt = page ? entityText(page.watermark, 'observedAt') : '';
	return (
		<div aria-busy={state.loading}>
			{state.loading && (
				<p role="status">
					Loading contract {tab}…
					{page ? ' Keeping the last successful page visible.' : ''}
				</p>
			)}
			{state.error && (
				<div role="alert" className={styles.error}>
					<p>{state.error}</p>
					{page && (
						<p>
							Showing the last successful page; the failed request did not
							replace these results.
						</p>
					)}
					<button disabled={state.loading} onClick={onRetry}>
						Retry contract {tab}
					</button>
				</div>
			)}
			{page && (
				<p className={styles.muted}>
					Page {state.pageIndex + 1} · {page.rows.length}{' '}
					{tab === 'events' ? 'events' : 'state changes'} returned.
					{minimum && maximum && (
						<>
							{' '}
							Query ledgers {minimum}–{maximum}.
						</>
					)}{' '}
					Imported records only; unavailable historical data is not evidence of
					no activity.
				</p>
			)}
			{page && observedAt && (
				<p className={styles.muted}>
					Query watermark recorded <LocalDateTime dateTime={observedAt} />.
				</p>
			)}
			{page && Object.keys(page.coverage).length > 0 && (
				<details>
					<summary>Published dataset coverage</summary>
					<p>
						Contiguous imported ledgers:{' '}
						{entityText(page.coverage, 'contiguousFirstLedger') ||
							'not reported'}
						–
						{entityText(page.coverage, 'contiguousLastLedger') ||
							'not reported'}
						.
					</p>
					<p>
						Coverage describes imported data, not complete network history or
						current contract state.
					</p>
				</details>
			)}
			{!state.loading && !state.error && page?.rows.length === 0 && (
				<p>
					No contract {tab} were returned from imported records in this query
					window.
				</p>
			)}
			{page?.rows.map((row, index) => (
				<ExplorerContractRecord
					key={
						entityText(row, 'id') ||
						entityText(row, '_row_number') + ':' + index
					}
					row={row}
					tab={tab}
				/>
			))}
			<div className={styles.actions}>
				<button
					disabled={state.loading || state.pageIndex === 0}
					onClick={onPrevious}
				>
					Previous {tab}
				</button>
				<button
					disabled={state.loading || !page || page.nextPosition === null}
					onClick={onNext}
				>
					Next {tab}
				</button>
				<button disabled={state.loading || !page} onClick={onRefresh}>
					Refresh current page
				</button>
			</div>
		</div>
	);
}
