'use client';
import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { buildEntityHref, requestExplorerJson } from '../../api/explorer-analytics';
import { buildLedgerTransactionsPath, parseLedgerTransactions, validLedgerSequence, type LedgerTransactionPage } from '../../api/explorer-ledger-transactions';
import { sanitizeExplorerReturnTo } from '../../api/explorer-return-context';
import { ExplorerLink as Link, useExplorerReturnTo } from './explorer-investigation';
import { adjacentLedgerHref, ledgerActivityHref, readLedgerActivity } from './ledger-activity-route';
import { ExplorerTransactionTable } from './explorer-transaction-table';
import { ExplorerTransactionPageResults } from './explorer-transaction-page-results';
import type { TransactionPageResult } from './transaction-page-result';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import styles from './explorer-entity.module.css';

export function ExplorerLedgerActivity({ ledger }: { readonly ledger: string }): React.JSX.Element | null {
	return validLedgerSequence(ledger) ? <LedgerActivity key={ledger} ledger={ledger} /> : null;
}
function LedgerActivity({ ledger }: { readonly ledger: string }): React.JSX.Element {
	const pathname = usePathname() ?? buildEntityHref('ledgers', ledger);
	const params = useSearchParams();
	const query = params?.toString() ?? '';
	const returnTo = useExplorerReturnTo();
	const { open, offset } = readLedgerActivity(new URLSearchParams(query), ledger);
	const filters = { min_ledger: ledger, max_ledger: ledger, return_to: sanitizeExplorerReturnTo(returnTo ?? pathname + (query ? '?' + query : '')) ?? '/explorer' };
	const previous = adjacentLedgerHref(ledger, -1), next = adjacentLedgerHref(ledger, 1);
	const navigate = (visible: boolean, page = 0): void => {
		window.history.pushState(null, '', ledgerActivityHref(pathname, query, ledger, visible, page, window.location.hash));
	};
	return <section className={styles.workspace} aria-label="Ledger activity">
		<div className={styles.actions}>
			{previous && <Link href={previous}>← Previous ledger</Link>}
			{next && <Link href={next}>Next ledger →</Link>}
		</div>
		<div className={styles.actions}>
			<button type="button" aria-expanded={open} aria-controls="ledger-transactions" onClick={() => navigate(!open)}>Transactions</button>
			{(['operations', 'transfers', 'trades', 'offers', 'liquidity-pools'] as const).map((collection) => <Link key={collection} href={buildEntityHref(collection, undefined, filters)}>
				{collection === 'liquidity-pools' ? 'Pool changes' : collection.charAt(0).toUpperCase() + collection.slice(1)}
			</Link>)}
		</div>
		{open && <LedgerTransactions key={offset} ledger={ledger} offset={offset} onPage={(page) => navigate(true, page)} />}
	</section>;
}

export function LedgerTransactions({ ledger, offset, onPage, detailReturnTo, resultFilter }: {
	readonly ledger: string;
	readonly offset: number;
	readonly onPage: (offset: number) => void;
	readonly detailReturnTo?: string;
	readonly resultFilter?: TransactionPageResult;
}): React.JSX.Element {
	const request = useExplorerRequest<LedgerTransactionPage | null>(null, 'Transaction records could not be loaded.');
	const controller = useRef<AbortController | null>(null);
	const pathname = usePathname();
	const params = useSearchParams();
	const returnTo = useExplorerReturnTo();
	const load = useCallback(() => request.run(async () => {
		controller.current?.abort();
		const abort = new AbortController();
		controller.current = abort;
		try { return parseLedgerTransactions(ledger, offset, await requestExplorerJson(buildLedgerTransactionsPath(ledger, offset), abort.signal)); }
		finally { if (controller.current === abort) controller.current = null; }
	}), [ledger, offset, request.run]);
	useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
	const page = request.result;
	const nextOffset = page?.nextOffset ?? null;
	const rowOrigin = detailReturnTo ?? returnTo ?? (pathname ?? buildEntityHref('ledgers', ledger)) + (params?.size ? '?' + params.toString() : '');
	const pagination = (page || offset > 0) && <div className={styles.actions} role="group" aria-label="Transaction pages">
		<span>Page {Math.floor(offset / 25) + 1}{page && page.records.length > 0
			? ' · Rows ' + (offset + 1) + '–' + (offset + page.records.length) : ''}</span>
		<button disabled={request.loading || offset === 0} onClick={() => onPage(Math.max(0, offset - 25))}>Previous transactions</button>
		<button disabled={request.loading || nextOffset === null || nextOffset > 10000} onClick={() => { if (nextOffset !== null) onPage(nextOffset); }}>Next transactions</button>
	</div>;
	return <section id="ledger-transactions" aria-label="Ledger transactions" aria-busy={request.loading}>
		<h3>Transactions in ledger {ledger}</h3>
		<p className={styles.muted}>Published records only. This endpoint does not confirm ledger coverage.</p>
		{pagination}
		<ExplorerRequestNotice loading={request.loading} error={request.error} onRetry={() => void load()}
			hasPrevious={Boolean(page?.records.length)} loadingMessage="Loading transactions…" />
		{page && <>
			{page.records.length ? (resultFilter === undefined
				? <ExplorerTransactionTable transactions={page} returnTo={rowOrigin} />
				: <ExplorerTransactionPageResults transactions={page} result={resultFilter}
					caption="Published rows for this ledger · Times shown locally." returnTo={rowOrigin} />)
				: !request.error && !request.loading && <p>No published transaction records returned for this page.</p>}
		</>}
		{nextOffset !== null && nextOffset > 10000 && <p className={styles.muted}>Pagination limit reached.</p>}
	</section>;
}
