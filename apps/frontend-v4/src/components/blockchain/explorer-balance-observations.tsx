'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { readWalletCursor, validWalletCursor, walletBalanceHref } from './wallet-balance-route';
import { ExplorerLink as Link } from './explorer-investigation';
import { buildEntityHref } from '../../api/explorer-analytics';
import {
	fetchBalanceObservations,
	type BalanceObservationKind,
	type BalanceObservationPage
} from '../../api/explorer-balance-observations';
import { useExplorerRequest } from './use-explorer-request';
import { withExplorerRequestDeadline } from './explorer-request';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { BalanceObservationProvenance } from './explorer-balance-provenance';
import { ObservedBalanceFlags } from './explorer-balance-flags';
import { formatAtomic } from './explorer-format-values';
import { formatObservedAmount, observedTrustlineLimit, ObservedAmountSource } from './explorer-observed-amount';
import styles from './explorer-entity.module.css';

interface LoadedPage {
	readonly page: BalanceObservationPage;
	readonly cursor: string | null;
	readonly history: readonly (string | null)[];
}
interface Props {
	readonly autoLoad?: boolean;
	readonly kind: BalanceObservationKind;
	readonly identifier: string;
}
interface WalletPagination {
	readonly after: string | null;
	readonly previousLabel: string;
	readonly first: () => void;
	readonly previous: () => void;
	readonly next: (after: string) => void;
}

export function ExplorerBalanceObservations(props: Props): React.JSX.Element {
	return props.kind === 'balances'
		? <WalletBalances key={props.identifier} {...props} />
		: <ObservationPanel key={props.identifier} {...props} />;
}

function WalletBalances(props: Props): React.JSX.Element {
	const pathname = usePathname() ?? buildEntityHref('accounts', props.identifier);
	const params = useSearchParams();
	const query = params?.toString() ?? '';
	const after = readWalletCursor(new URLSearchParams(query), props.identifier);
	const previousPages = useRef(new Map<string, string | null>());
	const navigate = (cursor: string | null): void => {
		window.history.pushState(null, '', walletBalanceHref(pathname, query, props.identifier, cursor, window.location.hash));
	};
	return <ObservationPanel key={after ?? ''} {...props} autoLoad={props.autoLoad || after !== null}
		pagination={{ after,
			previousLabel: after && previousPages.current.has(after) ? 'Previous balances' : 'First balances',
			first: () => navigate(null),
			previous: () => navigate(after ? previousPages.current.get(after) ?? null : null),
			next: (cursor) => {
				previousPages.current.set(cursor, after);
				const oldest = previousPages.current.keys().next().value;
				if (previousPages.current.size > 50 && oldest) previousPages.current.delete(oldest);
				navigate(cursor);
			}
		}} />;
}

function ObservationPanel({
	autoLoad = false,
	kind,
	identifier,
	pagination
}: Props & { readonly pagination?: WalletPagination }): React.JSX.Element {
	const request = useExplorerRequest<LoadedPage | null>(
		null,
		`Parsed ${kind} are temporarily unavailable. Try this request again.`
	);
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const current = request.result;
	const load = useCallback(
		(cursor: string | null, history: readonly (string | null)[]): void => {
			void request.run(async () => {
				controller.current?.abort();
				const abort = new AbortController();
				controller.current = abort;
				try {
					return {
						page: await withExplorerRequestDeadline(abort, 25_000, () =>
							fetchBalanceObservations(kind, identifier, cursor, abort.signal)
						),
						cursor,
						history
					};
				} finally {
					if (controller.current === abort) controller.current = null;
				}
			});
		},
		[identifier, kind, request.run]
	);
	const initialCursor = pagination?.after ?? null;
	useEffect(() => {
		if (autoLoad) load(initialCursor, []);
	}, [autoLoad, initialCursor, load]);
	return (
		<section
			className={styles.panel}
			aria-label={
				kind === 'balances' ? 'Parsed account balances' : 'Parsed asset holders'
			}
			aria-busy={request.loading}
		>
			<h2>{kind === 'balances' ? 'Account balances' : 'Asset holders'}</h2>
			<BalanceObservationProvenance kind={kind} page={current?.page} />
			<div className={styles.actions}>
				<button
					type="button"
					disabled={request.loading}
					onClick={() => pagination?.after ? pagination.first() : load(null, [])}
				>
					{current || autoLoad ? 'Refresh first page' : `Load ${kind}`}
				</button>
			</div>
			<ExplorerRequestNotice
				loading={request.loading}
				error={request.error}
				onRetry={request.retry}
			/>
			{current && (
				<>
					<BalanceObservationResults kind={kind} page={current.page} showProvenance={false} />
					<div className={styles.actions}>
						<button
							type="button"
							disabled={request.loading || (pagination ? pagination.after === null : current.history.length === 0)}
							onClick={() => pagination ? pagination.previous() :
								load(
									current.history.at(-1) ?? null,
									current.history.slice(0, -1)
								)
							}
						>
							{pagination ? pagination.previousLabel : `Previous ${kind}`}
						</button>
						<button
							type="button"
							disabled={request.loading || (pagination ? !validWalletCursor(current.page.nextCursor) : current.page.nextCursor === null)}
							onClick={() => pagination && current.page.nextCursor ? pagination.next(current.page.nextCursor) :
								load(current.page.nextCursor, [
									...current.history,
									current.cursor
								])
							}
						>
							Next {kind}
						</button>
						<span>{current.page.rows.length} returned</span>
					</div>
				</>
			)}
		</section>
	);
}

export function BalanceObservationResults({
	kind,
	page,
	showProvenance = true
}: {
	readonly kind: BalanceObservationKind;
	readonly page: BalanceObservationPage;
	readonly showProvenance?: boolean;
}): React.JSX.Element {
	const label = kind === 'balances' ? 'Asset' : 'Account';
	return (
		<>
			{showProvenance && <BalanceObservationProvenance kind={kind} page={page} />}
			{page.rows.length === 0 ? (
				<p>
					No {kind} returned from the ingested observations. This does not
					establish absence on the current chain.
				</p>
			) : (
				<div className={styles.tableWrap}>
					<table className={styles.table}>
						<thead>
							<tr>
								{[
									label,
									'Observed balance',
									'Liabilities',
									'Ledger evidence'
								].map((column) => (
									<th key={column} scope="col">
										{column}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{page.rows.map((row) => (
								<tr key={row.id}>
									<td data-label={label}>
										<Link
											className={styles.hash}
											href={buildEntityHref(
												kind === 'balances' ? 'assets' : 'accounts',
												row.id
											)}
										>
											{row.id === 'native' ? 'XLM (native)' : row.id}
										</Link>
										{kind === 'balances' && <ObservedBalanceFlags evidence={row} />}
									</td>
									<td data-label="Observed balance">
										<div>
										{formatObservedAmount(row.balance)}
										{kind === 'balances' && observedTrustlineLimit(row) !== null && (
											<div className={styles.muted}>
												Trustline limit: {observedTrustlineLimit(row)}
											</div>
										)}
										<ObservedAmountSource row={row} />
										</div>
									</td>
									<td data-label="Liabilities">
										<div>
										Buying: {formatObservedAmount(row.buyingLiabilities)}
										<br />
										Selling: {formatObservedAmount(row.sellingLiabilities)}
										</div>
									</td>
									<td data-label="Ledger evidence">
										<div>
										<Link
											href={buildEntityHref(
												'ledgers',
												String(row.observedLedger)
											)}
										>
											Observed {formatAtomic(String(row.observedLedger), 0)}
										</Link>
										<div className={styles.muted}>
											<Link href={buildEntityHref('ledgers', String(row.lastModifiedLedger))}>Last modified {formatAtomic(String(row.lastModifiedLedger), 0)}</Link>
										</div>
										</div>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</>
	);
}
