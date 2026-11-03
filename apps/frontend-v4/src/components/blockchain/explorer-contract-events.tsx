'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ExplorerFilters } from '../../api/explorer-analytics';
import { ExplorerContractActivity } from './explorer-contract-activity';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { readEventRouteInput } from './contract-event-route';
import {
	contractEventExample,
	contractEventQueryError,
	contractEventWorkspaceHref
} from './contract-event-query';
import styles from './explorer-entity.module.css';
import events from './explorer-contract-events.module.css';

export function ExplorerContractEvents({
	filters: initialFilters
}: {
	readonly filters: ExplorerFilters;
}): React.JSX.Element {
	const params = useSearchParams();
	const filters = Object.values(initialFilters).some(Boolean)
		? readEventRouteInput(initialFilters, new URLSearchParams(params.toString()))
		: initialFilters;
	const requested = Object.values(filters).some(Boolean);
	const error = requested ? contractEventQueryError(filters) : null;
	const contractId = filters.contract_id?.trim() ?? '';
	const valid = requested && !error;
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="contract-events" />
			<section className={styles.panel}>
				<header className={events.heading}>
					<div>
						<h2>Contract events</h2>
						<p className={styles.muted}>
							Read decoded topics and payloads. Follow each event to its
							transaction.
						</p>
					</div>
					<Link href="/docs/contract-events">Event guide &amp; API</Link>
				</header>
				<form
					action="/explorer/contract-events"
					method="get"
					className={events.form}
					key={JSON.stringify(filters)}
				>
					{params.get('return_to') && <input type="hidden" name="return_to" value={params.get('return_to') ?? ''} />}
					{params.get('activity') === 'state' && <input type="hidden" name="activity" value="state" />}
					{params.get('activity') === 'state' && ['ledger_key_hash', 'durability', 'deleted', 'state_offset', 'state_for'].map(name => params.has(name)
						? <input key={name} type="hidden" name={name} value={params.get(name) ?? ''} /> : null)}
					{['order', 'limit', 'q'].map((name) =>
						filters[name] ? (
							<input
								key={name}
								type="hidden"
								name={name}
								value={filters[name]}
							/>
						) : null
					)}
					<label className={events.wide}>
						Contract address
						<input
							name="contract_id"
							defaultValue={contractId}
							required
							pattern="C[A-Z2-7]{55}"
							maxLength={56}
							placeholder="C…"
							spellCheck={false}
							autoCapitalize="off"
							autoComplete="off"
						/>
					</label>
					<label>
						First ledger
						<input
							name="min_ledger"
							type="number"
							min={1}
							max={2147483647}
							step={1}
							required
							defaultValue={filters.min_ledger ?? ''}
						/>
					</label>
					<label>
						Last ledger
						<input
							name="max_ledger"
							type="number"
							min={1}
							max={2147483647}
							step={1}
							required
							defaultValue={filters.max_ledger ?? ''}
						/>
					</label>
					<label>
						Event type
						<select name="type_code" defaultValue={filters.type_code ?? ''}>
							<option value="">All types</option>
							<option value="0">System</option>
							<option value="1">Contract</option>
							<option value="2">Diagnostic</option>
						</select>
					</label>
					<label>
						Transaction outcome
						<select name="successful" defaultValue={filters.successful ?? ''}>
							<option value="">All outcomes</option>
							<option value="true">Successful</option>
							<option value="false">Failed</option>
						</select>
					</label>
					<label>
						Topic <span className={styles.muted}>(optional)</span>
						<input
							name="topic"
							defaultValue={filters.topic ?? ''}
							maxLength={128}
							placeholder="transfer, mint…"
							spellCheck={false}
						/>
					</label>
					<label className={events.hash}>
						Transaction hash <span className={styles.muted}>(optional)</span>
						<input
							name="transaction_hash"
							defaultValue={filters.transaction_hash ?? ''}
							pattern="[a-fA-F0-9]{64}"
							maxLength={64}
							placeholder="Filter to one transaction"
							spellCheck={false}
						/>
					</label>
					<label>
						Contract-call outcome
						<select
							name="in_successful_contract_call"
							defaultValue={filters.in_successful_contract_call ?? ''}
						>
							<option value="">All calls</option>
							<option value="true">Successful call</option>
							<option value="false">Not successful</option>
						</select>
					</label>
					<div className={`${styles.actions} ${events.wide}`}>
						<button type="submit">Search events</button>
						<Link
							href={contractEventWorkspaceHref(contractEventExample)}
							prefetch={false}
						>
							Try an imported example
						</Link>
						<Link href="/explorer/contract-events">Clear filters</Link>
					</div>
				</form>
				<p className={styles.muted}>
					Queries run on submission, not while you type. The example uses a
					historical imported ledger, not the live network head.{' '}
					<Link href="/docs/api/listHubbleDatasets">
						Check available ranges
					</Link>
					.
				</p>
				{error && (
					<p className={styles.error} role="alert">
						{error}
					</p>
				)}
			</section>
			{valid ? (
				<>
					<div className={styles.actions}>
						<Link href="/docs/api/listAnalyticsContractEvents">
							REST schema &amp; request tester
						</Link>
						<Link href="/docs/graphql">GraphQL query runner</Link>
					</div>
					<ExplorerContractActivity
						key={contractId}
						contractId={contractId}
						filters={filters}
					/>
				</>
			) : (
				!error && (
					<section className={styles.panel}>
						<h3>Start with a contract and ledger range</h3>
						<p className={styles.muted}>
							Use your own contract or try the imported example. Results include
							decoded values, transaction and call outcomes, source
							classification, and cursor pagination. No wallet connection is
							needed.
						</p>
					</section>
				)
			)}
		</div>
	);
}
