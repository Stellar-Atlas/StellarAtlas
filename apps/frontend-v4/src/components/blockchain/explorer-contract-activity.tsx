'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
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
	createContractActivityState,
	type ContractActivityState
} from './explorer-contract-activity-model';
import styles from './explorer-entity.module.css';
import ui from './explorer-contract-controls.module.css';
import {
	applyEventControls,
	createEventControls,
	type EventControls
} from './contract-event-controls';
import { eventControlsHref, eventPositionHref, readEventRoute } from './contract-event-route';
import { ExplorerInvestigationScope } from './explorer-investigation';
import { contractActivityTabHref, readContractActivityTab } from './contract-activity-route';
export function ExplorerContractActivity({
	contractId,
	filters,
	token
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
	readonly token?: EventTokenContext;
}): React.JSX.Element {
	const pathname = usePathname();
	const params = useSearchParams();
	const tab = readContractActivityTab(params.get('activity'));
	const setTab = (next: ContractActivityTab) => {
		const href = contractActivityTabHref(
			pathname, window.location.search, next, window.location.hash
		);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
	};
	const applied = readEventRoute(filters, new URLSearchParams(params.toString()));
	const controls = createEventControls(applied);
	const setControls = (update: (current: EventControls) => EventControls): void => {
		const href = eventControlsHref(pathname, window.location.search, update(controls), window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
	};
	const [search, setSearch] = useState(controls.q);
	useEffect(() => setSearch(controls.q), [controls.q]);
	const resultKey = contractId + ':' + tab + ':' + JSON.stringify(applied);
	const [acceptedSummary, setSummary] = useState<{ key: string; value: ContractActivityPage['summary'] }>();
	const summary = acceptedSummary?.key === resultKey ? acceptedSummary.value : undefined;
	const onSummary = useCallback(
		(value: ContractActivityPage['summary']) => setSummary({ key: resultKey, value }),
		[resultKey]
	);
	const position = applied.after ?? '';
	const queryKey = contractId + ':' + JSON.stringify(applyEventControls(applied, controls));
	const previousPositions = useRef(new Map<string, string>());
	const previous = previousPositions.current.get(queryKey + ':' + position);
	const move = (next: string, remember = false): void => {
		if (remember) {
			previousPositions.current.set(queryKey + ':' + next, position);
			const oldest = previousPositions.current.keys().next().value;
			if (previousPositions.current.size > 50 && oldest) previousPositions.current.delete(oldest);
		}
		const href = eventPositionHref(pathname, window.location.search, next, window.location.hash);
		if (href !== window.location.pathname + window.location.search + window.location.hash)
			window.history.pushState(null, '', href);
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
						<a
							href={eventControlsHref(pathname, params.toString(), controls)}
						>
							Link to this query
						</a>
					</form>
				</div>
			)}
			<ContractActivityResults
				key={resultKey}
				contractId={contractId}
				filters={
					tab === 'events' ? applied : { ...filters, limit: controls.limit }
				}
				tab={tab}
				token={token}
				onSummary={onSummary}
				onNextPosition={next => move(next, Boolean(next))}
				onPreviousPosition={previous === undefined ? undefined : () => move(previous)}
			/>
		</section>
	);
}

function ContractActivityResults({
	contractId,
	filters,
	tab,
	token,
	onSummary,
	onNextPosition,
	onPreviousPosition
}: {
	readonly contractId: string;
	readonly filters: ExplorerFilters;
	readonly tab: ContractActivityTab;
	readonly token?: EventTokenContext;
	readonly onSummary: (value: ContractActivityPage['summary']) => void;
	readonly onNextPosition: (position: string) => void;
	readonly onPreviousPosition?: () => void;
}): React.JSX.Element {
	const pathname = usePathname(), params = useSearchParams();
	const [state, dispatch] = useReducer(
		contractActivityReducer,
		tab === 'events' ? (filters.after ?? '') : '',
		createContractActivityState
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
		const origin = window.location.pathname + window.location.search;
		const current = (): boolean => !disposed && window.location.pathname + window.location.search === origin;
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
				if (current() && !abort.signal.aborted) {
					dispatch({ type: 'loaded', requestId, page });
					onSummary(page.summary);
				}
			})
			.catch((error: unknown) => {
				if (current())
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
	const displayedPosition = state.positions[state.pageIndex] ?? '';
	const pageHref = eventPositionHref(pathname, params.toString(), displayedPosition);
	const view = (
		<ContractActivityView
			state={state}
			tab={tab}
			token={token}
			slow={slow}
			onCancel={() => active.current?.abort()}
			onRetry={() => dispatch({ type: 'retry' })}
			onPrevious={tab === 'events' ? onPreviousPosition ?? (() => {}) : () => dispatch({ type: 'previous' })}
			onNext={tab === 'events' ? () => state.page?.nextPosition && onNextPosition(state.page.nextPosition) : () => dispatch({ type: 'next' })}
			onRefresh={() => dispatch({ type: 'refresh' })}
			canPrevious={tab === 'events' ? onPreviousPosition !== undefined : undefined}
		/>
	);
	const linkedView = <>
		<div className={styles.actions}><a
			href={'https://api.stellaratlas.io' + (state.page ? contractActivityPath(contractId, tab, filters, displayedPosition) : path)}
			target="_blank" rel="noreferrer">Open REST response</a></div>
		{view}
	</>;
	return tab === 'events' ? (
		<ExplorerInvestigationScope origin={pageHref}>
			{linkedView}
			<div className={styles.actions}>
				{state.page && <a href={pageHref}>Link to this page</a>}
				{displayedPosition && <button disabled={state.loading} onClick={() => onNextPosition('')}>First page</button>}
			</div>
		</ExplorerInvestigationScope>
	) : (
		linkedView
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
	onRefresh,
	canPrevious
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
	readonly canPrevious?: boolean;
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
					{page && <p>Showing previous results.</p>}
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
			{page && page.rows.length === 0 && (
				<p className={ui.count}>
					No {tab === 'events' ? 'events' : 'changes'} in this imported window.
				</p>
			)}
			<div className={ui.pagination}>
				<span>
					{page
						? `${page.rows.length} ${tab === 'events' ? page.rows.length === 1 ? 'event' : 'events' : page.rows.length === 1 ? 'change' : 'changes'}${state.positions[0] ? ' · Continued query' : ` · Page ${state.pageIndex + 1}`}`
						: ''}
				</span>
				<div>
					<button
						disabled={state.loading || !(canPrevious ?? state.pageIndex > 0)}
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
