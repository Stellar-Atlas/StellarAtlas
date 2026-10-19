'use client';
import { useEffect, useRef, useState } from 'react';
import {
	requestExplorerTransaction,
	transactionRelations as relations,
	type TransactionRelation as Relation,
	type TransactionCursors as Cursors
} from '../../api/explorer-transaction';
import {
	buildEntityHref,
	entityText,
	recordValue,
	type EntityRecord
} from '../../api/explorer-analytics';
import { LocalDateTime } from '../local-date-time';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { EntityLink } from './explorer-entity-table';
import { ExplorerContractEventTable } from './explorer-contract-event-table';
import { ExplorerOperationCall } from './explorer-operation-call';
import { operationInvocation } from './explorer-operation-invocation';
import { formatAtomic } from './explorer-format-values';
import { ExplorerLink as Link } from './explorer-investigation';
import styles from './explorer-entity.module.css';

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
	const invocationRow = { ...row, details };
	const hasInvocation =
		relation === 'operations' && operationInvocation(invocationRow) !== null;
	return (
		<article className={styles.panel}>
			<h4>
				{type.replaceAll('_', ' ')}
				{relation === 'operations' && id ? (
					<>
						{' '}
						·{' '}
						<EntityLink
							collection="operations"
							id={id}
							filters={{ min_ledger: ledger, max_ledger: ledger }}
						/>
					</>
				) : null}
			</h4>
			{hasInvocation && (
				<ExplorerOperationCall
					row={invocationRow}
					filters={{ min_ledger: ledger, max_ledger: ledger }}
				/>
			)}
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
						([key, value]) =>
							!(
								hasInvocation &&
								['type', 'function', 'contract_id'].includes(key)
							) &&
							(typeof value === 'string' ||
								typeof value === 'number' ||
								typeof value === 'boolean')
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
	const [data, setData] = useState<EntityRecord | null>(null);
	const activeRequest = useRef<AbortController | null>(null);
	const resolvedLedger = useRef<{ hash: string; ledger: string } | null>(null);
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
		activeRequest.current = abort;
		setBusy(true);
		setError(null);
		void (async () => {
			const selected =
				ledger ||
				(resolvedLedger.current?.hash === hash
					? resolvedLedger.current.ledger
					: '');
			const result = await requestExplorerTransaction(
				hash,
				selected,
				cursors,
				abort.signal
			);
			if (!disposed) {
				const foundLedger = entityText(
					recordValue(result.transaction),
					'ledgerSequence'
				);
				resolvedLedger.current = { hash, ledger: foundLedger };
				if (foundLedger) setInput(foundLedger);
				setData(result);
			}
		})()
			.catch((failure) => {
				if (!disposed)
					setError(
						abort.signal.aborted
							? 'Transaction request cancelled.'
							: failure instanceof Error
								? failure.message
								: 'Transaction data could not be loaded.'
					);
			})
			.finally(() => {
				if (activeRequest.current === abort) activeRequest.current = null;
				if (!disposed) setBusy(false);
			});
		return () => {
			disposed = true;
			abort.abort();
		};
	}, [hash, ledger, cursors, retry]);
	const tx = data ? recordValue(data.transaction) : null;
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
					className={`${styles.actions} ${styles.lookupForm}`}
					onSubmit={(event) => {
						event.preventDefault();
						setLedger(input);
						setCursors({});
						setHistory({});
						setRetry((value) => value + 1);
					}}
				>
					<label>
						Ledger number (optional){' '}
						<input
							inputMode="numeric"
							value={input}
							onChange={(event) => setInput(event.currentTarget.value)}
						/>
					</label>
					<button disabled={busy}>Load transaction</button>
					{busy && (
						<button
							type="button"
							onClick={() => activeRequest.current?.abort()}
						>
							Cancel query
						</button>
					)}
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
						<dt>Fee (XLM)</dt>
						<dd>
							<span
								title={
									(entityText(tx, 'feeChargedRaw') ||
										entityText(tx, 'feeCharged')) + ' stroops'
								}
							>
								{formatAtomic(
									entityText(tx, 'feeChargedRaw') ||
										entityText(tx, 'feeCharged'),
									7
								)}
							</span>
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
									{items.length && relation === 'events' ? (
										<ExplorerContractEventTable rows={items} />
									) : items.length ? (
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
