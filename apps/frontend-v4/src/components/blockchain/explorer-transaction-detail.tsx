'use client';
import { useEffect, useState } from 'react';
import { searchExplorer } from '../../app/actions/network-data';
import {
	buildEntityHref,
	entityText,
	recordValue,
	requestExplorerJson,
	type EntityRecord
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { EntityLink } from './explorer-entity-table';
import Link from 'next/link';
import styles from './explorer-entity.module.css';

type Relation = 'operations' | 'effects' | 'events';
const relations: readonly Relation[] = ['operations', 'effects', 'events'];
type Cursors = Partial<Record<Relation, string>>;
function decoded(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return value;
	}
}
function JsonValue({ value }: { readonly value: unknown }): React.JSX.Element {
	const parsed = decoded(value);
	return (
		<pre className={styles.json}>
			{typeof parsed === 'string'
				? parsed
				: JSON.stringify(parsed ?? null, null, 2)}
		</pre>
	);
}
function RelationRecord({
	row,
	relation,
	ledger
}: {
	readonly row: EntityRecord;
	readonly relation: Relation;
	readonly ledger: string;
}): React.JSX.Element {
	const id = entityText(row, 'id'),
		type =
			entityText(row, 'type') ||
			entityText(row, 'classification') ||
			relation.replace(/s$/, '');
	const amounts = Array.isArray(row.amounts)
		? row.amounts.map(recordValue)
		: [];
	const details = recordValue(decoded(row.detailsJson));
	return (
		<article className={styles.panel}>
			<h4>
				{type}
				{relation === 'operations' && id ? (
					<>
						{' '}
						· <EntityLink collection="operations" id={id} />
					</>
				) : null}
			</h4>
			<dl className={styles.details}>
				{amounts.flatMap((amount, index) => [
					<dt key={'a' + index}>{entityText(amount, 'field')}</dt>,
					<dd key={'v' + index}>
						{entityText(amount, 'decimal')}{' '}
						<small>({entityText(amount, 'raw')} raw units)</small>
					</dd>
				])}
				{Object.entries(details)
					.filter(
						([, value]) =>
							typeof value === 'string' ||
							typeof value === 'number' ||
							typeof value === 'boolean'
					)
					.slice(0, 30)
					.flatMap(([key, value]) => [
						<dt key={key + 'label'}>{key.replaceAll('_', ' ')}</dt>,
						<dd key={key}>{String(value)}</dd>
					])}
				{entityText(row, 'contractId') && (
					<>
						<dt>Contract</dt>
						<dd>
							<EntityLink
								collection="contracts"
								id={entityText(row, 'contractId')}
								filters={{ min_ledger: ledger, max_ledger: ledger }}
							/>
						</dd>
					</>
				)}
			</dl>
			{relation === 'events' ? (
				<>
					<h5>Topics</h5>
					<JsonValue value={row.topicsJson} />
					<h5>Payload</h5>
					<JsonValue value={row.dataJson} />
				</>
			) : null}
			<details>
				<summary>
					{relation === 'operations'
						? 'Decoded operation envelope'
						: 'Complete record'}
				</summary>
				<JsonValue
					value={relation === 'operations' ? decoded(row.detailsJson) : row}
				/>
			</details>
		</article>
	);
}
export function ExplorerTransactionDetail({
	hash,
	ledgerSequence
}: {
	readonly hash: string;
	readonly ledgerSequence?: string;
}): React.JSX.Element {
	const [data, setData] = useState<EntityRecord | null>(null),
		[summary, setSummary] = useState<EntityRecord | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const [ledger, setLedger] = useState(ledgerSequence ?? ''),
		[input, setInput] = useState(ledgerSequence ?? ''),
		[cursors, setCursors] = useState<Cursors>({});
	const [history, setHistory] = useState<
		Partial<Record<Relation, (string | undefined)[]>>
	>({});
	const [retry, setRetry] = useState(0);
	useEffect(() => {
		let disposed = false;
		const abort = new AbortController();
		const timeout = setTimeout(() => abort.abort(), 25000);
		setBusy(true);
		setError(null);
		void (async () => {
			let selected = ledger;
			if (!selected) {
				const lookup = await searchExplorer(hash, 'transaction');
				if (disposed) return;
				const found = recordValue(lookup.search?.result);
				setSummary(found);
				selected =
					entityText(found, 'ledger') || entityText(found, 'ledgerSequence');
				if (!selected)
					throw new Error(
						lookup.message ||
							'The transaction ledger could not be located. Enter its ledger number to query the parsed history.'
					);
				setInput(selected);
			}
			const query = new URLSearchParams({
				view: 'typed',
				ledger_sequence: selected,
				limit: '20'
			});
			for (const relation of relations)
				if (cursors[relation])
					query.set(relation + '_after', cursors[relation] ?? '');
			const result = await requestExplorerJson(
				'/v1/analytics/transactions/' + encodeURIComponent(hash) + '?' + query,
				abort.signal
			);
			if (!disposed) setData(recordValue(result));
		})()
			.catch((failure) => {
				if (!disposed)
					setError(
						abort.signal.aborted
							? 'Transaction lookup timed out. Enter its ledger number and try again.'
							: failure instanceof Error
								? failure.message
								: 'Transaction data could not be loaded.'
					);
			})
			.finally(() => {
				clearTimeout(timeout);
				if (!disposed) setBusy(false);
			});
		return () => {
			disposed = true;
			abort.abort();
			clearTimeout(timeout);
		};
	}, [hash, ledger, cursors, retry]);
	const tx = data ? recordValue(data.transaction) : summary;
	const chosenLedger = tx
		? entityText(tx, 'ledgerSequence') || entityText(tx, 'ledger')
		: ledger;
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active="transactions" />
			<section className={styles.panel} aria-busy={busy}>
				<h2>Transaction</h2>
				<p className={styles.hash}>{hash}</p>
				<form
					className={styles.actions}
					onSubmit={(event) => {
						event.preventDefault();
						setLedger(input);
						setCursors({});
						setHistory({});
						setRetry((value) => value + 1);
					}}
				>
					<label>
						Ledger number{' '}
						<input
							inputMode="numeric"
							value={input}
							onChange={(event) => setInput(event.currentTarget.value)}
						/>
					</label>
					<button disabled={busy}>Load transaction</button>
				</form>
				{busy && <p role="status">Loading transaction and decoded activity…</p>}
				{error && (
					<p role="alert" className={styles.error}>
						{error}
					</p>
				)}
				{tx && Object.keys(tx).length > 0 && (
					<dl className={styles.details}>
						<dt>Ledger</dt>
						<dd>
							<EntityLink collection="ledgers" id={chosenLedger} />
						</dd>
						<dt>Closed</dt>
						<dd>
							<LocalDateTime
								dateTime={
									entityText(tx, 'closedAt') || entityText(tx, 'createdAt')
								}
							/>
						</dd>
						<dt>Source account</dt>
						<dd>
							<EntityLink
								collection="accounts"
								id={entityText(tx, 'sourceAccount')}
							/>
						</dd>
						<dt>Result</dt>
						<dd>
							{tx.successful === true
								? 'Successful'
								: tx.successful === false
									? 'Failed'
									: 'Not supplied'}{' '}
							{entityText(tx, 'resultCode')}
						</dd>
						<dt>Operations</dt>
						<dd>{entityText(tx, 'operationCount')}</dd>
						<dt>Fee (raw stroops)</dt>
						<dd>
							{entityText(tx, 'feeChargedRaw') || entityText(tx, 'feeCharged')}
						</dd>
						<dt>Memo</dt>
						<dd>{entityText(tx, 'memo') || 'None'}</dd>
					</dl>
				)}
				{data ? (
					<>
						<p className={styles.muted}>
							Decoded from the published Hubble dataset. Operations, effects and
							events have independent pagination.
						</p>
						{relations.map((relation) => {
							const page = recordValue(data[relation]),
								items = Array.isArray(page.items)
									? page.items.map(recordValue)
									: [];
							const next = entityText(page, 'nextCursor'),
								previous = history[relation] ?? [];
							return (
								<section key={relation} className={styles.panel}>
									<h3>
										{relation.charAt(0).toUpperCase() + relation.slice(1)}
									</h3>
									{items.length ? (
										items.map((row, index) => (
											<RelationRecord
												key={entityText(row, 'id') + ':' + index}
												row={row}
												relation={relation}
												ledger={chosenLedger}
											/>
										))
									) : (
										<p>No published {relation} for this transaction.</p>
									)}
									<div className={styles.actions}>
										<button
											disabled={busy || !previous.length}
											onClick={() => {
												setCursors((value) => ({
													...value,
													[relation]: previous.at(-1)
												}));
												setHistory((value) => ({
													...value,
													[relation]: previous.slice(0, -1)
												}));
											}}
										>
											Previous {relation}
										</button>
										<button
											disabled={busy || !next}
											onClick={() => {
												setHistory((value) => ({
													...value,
													[relation]: [...previous, cursors[relation]]
												}));
												setCursors((value) => ({ ...value, [relation]: next }));
											}}
										>
											Next {relation}
										</button>
									</div>
								</section>
							);
						})}
					</>
				) : tx ? (
					<p className={styles.muted}>
						Transaction summary is available; the parsed operations, effects and
						events have not been returned.
					</p>
				) : null}
				<Link
					href={buildEntityHref('transfers', undefined, {
						transaction_hash: hash,
						...(chosenLedger
							? { min_ledger: chosenLedger, max_ledger: chosenLedger }
							: {})
					})}
				>
					Transfers in this transaction
				</Link>
			</section>
		</div>
	);
}
