'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ExplorerFilters } from '../../api/explorer-analytics';
import {
	contractActivityPath,
	requestContractActivity,
	type ContractActivityTab,
	type ContractActivityPage
} from '../../api/explorer-contract-activity';
import {
	ExplorerContractEventTable,
	type EventTokenContext
} from './explorer-contract-event-table';
import { ExplorerContractStateChangeTable } from './explorer-contract-state-change-table';
import {
	contractActivityReducer,
	initialContractActivityState,
	type ContractActivityState
} from './explorer-contract-activity-model';
import styles from './explorer-entity.module.css';
import ui from './explorer-contract-controls.module.css';

type Controls = {
	type: string;
	order: 'asc' | 'desc';
	limit: string;
	topic: string;
	q: string;
};
export function ExplorerContractActivity({
	contractId,
	filters,
	token
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
	readonly token?: EventTokenContext;
}): React.JSX.Element {
	const [tab, setTab] = useState<ContractActivityTab>('events');
	const [controls, setControls] = useState<Controls>({
		type: 'all',
		order: 'desc',
		limit: '25',
		topic: '',
		q: ''
	});
	const [search, setSearch] = useState('');
	const [summary, setSummary] = useState<ContractActivityPage['summary']>();
	const onSummary = useCallback(
		(value: ContractActivityPage['summary']) => setSummary(value),
		[]
	);
	const applied = {
		...filters,
		limit: controls.limit,
		order: controls.order,
		...(controls.type === 'all' ? {} : { type_code: controls.type }),
		...(controls.topic ? { topic: controls.topic } : {}),
		...(controls.q ? { q: controls.q } : {})
	};
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
			{tab === 'events' && (
				<div className={ui.controls}>
					<div className={ui.topRow}>
						<div className={ui.types} aria-label="Event type">
							{[
								['all', 'All events'],
								['1', 'Contract events'],
								['2', 'Diagnostics']
							].map(([value, label]) => (
								<button
									key={value}
									aria-pressed={controls.type === value}
									onClick={() =>
										setControls((current) => ({ ...current, type: value! }))
									}
								>
									{label}
								</button>
							))}
						</div>
						<label>
							Order
							<select
								value={controls.order}
								onChange={(event) =>
									setControls((current) => ({
										...current,
										order: event.target.value as 'asc' | 'desc'
									}))
								}
							>
								<option value="desc">Newest first</option>
								<option value="asc">Oldest first</option>
							</select>
						</label>
						<label>
							Rows
							<select
								value={controls.limit}
								onChange={(event) =>
									setControls((current) => ({
										...current,
										limit: event.target.value
									}))
								}
							>
								{['10', '25', '50', '100'].map((value) => (
									<option key={value} value={value}>
										{value}
									</option>
								))}
							</select>
						</label>
					</div>
					<div className={ui.topics} aria-label="Named event topics">
						<button
							aria-pressed={!controls.topic}
							onClick={() =>
								setControls((current) => ({ ...current, topic: '' }))
							}
						>
							All topics
						</button>
						{summary?.topics.map((topic) => (
							<button
								key={topic.topic}
								title={`${Number(topic.count).toLocaleString()} indexed events`}
								aria-pressed={controls.topic === topic.topic}
								onClick={() =>
									setControls((current) => ({ ...current, topic: topic.topic }))
								}
							>
								{topic.topic}
							</button>
						))}
					</div>
					<form
						className={ui.search}
						onSubmit={(event) => {
							event.preventDefault();
							setControls((current) => ({ ...current, q: search.trim() }));
						}}
					>
						<input
							aria-label="Search contract events"
							placeholder="Address, transaction hash or ledger"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
						<button>Search</button>
						{controls.q && (
							<button
								type="button"
								onClick={() => {
									setSearch('');
									setControls((current) => ({ ...current, q: '' }));
								}}
							>
								Clear
							</button>
						)}
						<span className={ui.count}>
							{summary
								? `${Number(summary.total).toLocaleString()} indexed events`
								: ''}
						</span>
					</form>
				</div>
			)}
			<ContractActivityResults
				key={contractId + ':' + tab + ':' + JSON.stringify(applied)}
				contractId={contractId}
				filters={
					tab === 'events' ? applied : { ...filters, limit: controls.limit }
				}
				tab={tab}
				token={token}
				onSummary={onSummary}
			/>
		</section>
	);
}

function ContractActivityResults({
	contractId,
	filters,
	tab,
	token,
	onSummary
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
	readonly tab: ContractActivityTab;
	readonly token?: EventTokenContext;
	readonly onSummary: (value: ContractActivityPage['summary']) => void;
}): React.JSX.Element {
	const [state, dispatch] = useReducer(
		contractActivityReducer,
		initialContractActivityState
	);
	const { requestId, requestedPosition } = state;
	const [slow, setSlow] = useState(false);
	const active = useRef<AbortController | null>(null);
	const path = contractActivityPath(
		contractId,
		tab,
		filters,
		requestedPosition
	);
	useEffect(() => {
		let disposed = false;
		const abort = new AbortController();
		active.current = abort;
		setSlow(false);
		const timer = setTimeout(() => setSlow(true), 5000);
		void requestContractActivity(
			path,
			contractId,
			tab,
			requestedPosition,
			abort.signal
		)
			.then((page) => {
				if (!disposed) {
					dispatch({ type: 'loaded', requestId, page });
					onSummary(page.summary);
				}
			})
			.catch((error: unknown) => {
				if (!disposed)
					dispatch({
						type: 'failed',
						requestId,
						error: abort.signal.aborted
							? 'Request cancelled.'
							: error instanceof Error
								? error.message
								: 'Data unavailable.'
					});
			})
			.finally(() => clearTimeout(timer));
		return () => {
			disposed = true;
			clearTimeout(timer);
			abort.abort();
		};
	}, [path, contractId, tab, requestedPosition, requestId, onSummary]);
	return (
		<ContractActivityView
			state={state}
			tab={tab}
			token={token}
			slow={slow}
			onCancel={() => active.current?.abort()}
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
	token,
	slow,
	onCancel,
	onRetry,
	onPrevious,
	onNext,
	onRefresh
}: {
	readonly state: ContractActivityState;
	readonly tab: ContractActivityTab;
	readonly token?: EventTokenContext;
	readonly slow?: boolean;
	readonly onCancel?: () => void;
	readonly onRetry: () => void;
	readonly onPrevious: () => void;
	readonly onNext: () => void;
	readonly onRefresh: () => void;
}): React.JSX.Element {
	const page = state.page;
	return (
		<div aria-busy={state.loading}>
			{state.loading && (
				<p role="status" className={ui.count}>
					{slow ? 'Query is still running…' : 'Loading…'}
					{page ? ' Previous page remains visible.' : ''}
				</p>
			)}
			{state.loading && slow && onCancel && (
				<button onClick={onCancel}>Cancel</button>
			)}
			{state.error && (
				<div role="alert" className={styles.error}>
					<p>{state.error}</p>
					<button disabled={state.loading} onClick={onRetry}>
						Retry
					</button>
				</div>
			)}
			{page &&
				(tab === 'events' ? (
					<ExplorerContractEventTable rows={page.rows} token={token} />
				) : (
					<ExplorerContractStateChangeTable rows={page.rows} />
				))}
			<div className={ui.pagination}>
				<span>
					{page
						? `${page.rows.length} ${tab === 'events' ? 'events' : 'changes'} · Page ${state.pageIndex + 1}`
						: ''}
				</span>
				<div>
					<button
						disabled={state.loading || state.pageIndex === 0}
						onClick={onPrevious}
					>
						Previous
					</button>
					<button
						disabled={state.loading || !page || page.nextPosition === null}
						onClick={onNext}
					>
						Next
					</button>
					<button disabled={state.loading || !page} onClick={onRefresh}>
						Refresh
					</button>
				</div>
			</div>
		</div>
	);
}
