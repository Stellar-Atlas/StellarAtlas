'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import { readTransactionActivityRoute, resolveTypedTransactionLedger, restoreTransactionRelation, transactionActivityHref, transactionActivityKey, transactionRelationPositionKey, validActivityCursor, validLedger, type TransactionActivityRoute } from './transaction-activity-route';
import {
	requestExplorerTransaction,
	transactionRelations as relations,
	type TransactionRelation as Relation
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
import { OperationResultFields } from './explorer-operation-result';
import { ExplorerRecordFields } from './explorer-record-fields';
import { ExplorerEffectFields } from './explorer-effect-fields';
import { ExplorerTransactionTransfers } from './explorer-transaction-transfers';
import { ExplorerTransactionOperationMix } from './explorer-transaction-operation-mix';
import { validTransactionTransferScope } from '../../api/transaction-transfers';
import { recordFieldInput } from './record-field-tree';
import { operationInvocation } from './explorer-operation-invocation';
import { formatAtomic } from './explorer-format-values';
import { ExplorerLink as Link } from './explorer-investigation';
import styles from './explorer-entity.module.css';

function decoded(value: unknown): unknown {
	return recordFieldInput(value);
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
				{relation === 'operations' && <OperationResultFields row={row} />}
				{relation === 'effects' && <ExplorerEffectFields row={row} ledger={ledger} />}
				{amounts.flatMap((amount, index) => [
					<dt key={'a' + index}>{entityText(amount, 'field')}</dt>,
					<dd key={'v' + index}>
						{entityText(amount, 'decimal')}{' '}
						<small>({entityText(amount, 'raw')} raw units)</small>
					</dd>
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
			<ExplorerRecordFields value={row.detailsJson} filters={{ min_ledger: ledger, max_ledger: ledger }}
				exclude={hasInvocation ? ['type', 'function', 'contract_id'] : []} rawFallback={false} />
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
	hash
}: {
	readonly hash: string;
}): React.JSX.Element {
	const params = useSearchParams();
	const query = params.toString();
	const route = useMemo(() => readTransactionActivityRoute(new URLSearchParams(query), hash), [query, hash]);
	return <TransactionDetail key={hash} hash={hash} route={route} />;
}

function TransactionDetail({ hash, route }: {
	readonly hash: string;
	readonly route: TransactionActivityRoute;
}): React.JSX.Element {
	const pathname = usePathname();
	const params = useSearchParams();
	const { ledger, cursors } = route;
	const requestKey = transactionActivityKey(route);
	const [loaded, setLoaded] = useState<{ key: string; data: EntityRecord; ledger: string } | null>(null);
	const data = loaded?.key === requestKey ? loaded.data : null;
	const navigationRoute = ledger || !loaded ? route : { ...route, ledger: loaded.ledger };
	const activeRequest = useRef<AbortController | null>(null);
	const resolvedLedger = useRef<{ hash: string; ledger: string } | null>(null);
	const [busy, setBusy] = useState(false),
		[error, setError] = useState<string | null>(null);
	const [input, setInput] = useState(ledger);
	const previousPages = useRef(new Map<string, string | null>());
	const [retry, setRetry] = useState(0);
	const navigate = (selection: TransactionActivityRoute): void => {
		window.history.pushState(null, '', transactionActivityHref(pathname, params.toString(), selection, hash, window.location.hash));
	};
	const previousControl = (relation: Relation) => {
		const previous = previousPages.current.get(transactionRelationPositionKey(navigationRoute, relation));
		return <button key={relation} type="button" disabled={busy || !cursors[relation]}
			onClick={() => navigate(restoreTransactionRelation(navigationRoute, relation, previous))}>
			{previous === undefined ? 'First' : 'Previous'} {relation}
		</button>;
	};
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
				const foundLedger = resolveTypedTransactionLedger(hash, selected, recordValue(result.transaction));
				resolvedLedger.current = { hash, ledger: foundLedger };
				setInput(foundLedger);
				setLoaded({ key: requestKey, data: result, ledger: foundLedger });
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
	}, [hash, ledger, requestKey, retry]);
	useEffect(() => setInput(ledger), [ledger]);
	const tx = data ? recordValue(data.transaction) : null;
	const chosenLedger = data ? navigationRoute.ledger : ledger;
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
						const selection = { ledger: input.trim(), cursors: {} };
						if (transactionActivityKey(selection) === requestKey) setRetry((value) => value + 1);
						else navigate(selection);
					}}
				>
					<label>
						Ledger number (optional){' '}
						<input
							inputMode="numeric"
							maxLength={10}
							pattern="[1-9][0-9]{0,9}"
							value={input}
							onChange={(event) => setInput(event.currentTarget.value)}
						/>
					</label>
					<button disabled={busy || !validLedger(input.trim())}>Load transaction</button>
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
						<button type="button" onClick={() => setRetry((value) => value + 1)} disabled={busy}>Try again</button>
					</p>
				)}
				{error && !data && relations.some(relation => cursors[relation]) &&
					<div className={styles.actions} role="group" aria-label="Transaction activity page recovery">
						{relations.filter(relation => cursors[relation]).map(previousControl)}
					</div>}
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
							const next = entityText(page, 'nextCursor');
							return (
								<section key={relation} className={styles.panel}>
									<h3>
										{relation.charAt(0).toUpperCase() + relation.slice(1)}
									</h3>
									{relation === 'operations' && <ExplorerTransactionOperationMix rows={items} />}
									{items.length && relation === 'events' ? (
										<ExplorerContractEventTable
											rows={items}
											showTransaction={false}
										/>
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
										{previousControl(relation)}
										<button
											disabled={busy || !validActivityCursor(next)}
											onClick={() => {
												const selection = { ...navigationRoute, cursors: { ...cursors, [relation]: next } };
												previousPages.current.set(transactionRelationPositionKey(selection, relation), cursors[relation] ?? null);
												const oldest = previousPages.current.keys().next().value;
												if (previousPages.current.size > 50 && oldest) previousPages.current.delete(oldest);
												navigate(selection);
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
				{tx && validTransactionTransferScope({ hash, ledger: chosenLedger }) &&
					<ExplorerTransactionTransfers key={hash + ':' + chosenLedger} hash={hash} ledger={chosenLedger} />}
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
