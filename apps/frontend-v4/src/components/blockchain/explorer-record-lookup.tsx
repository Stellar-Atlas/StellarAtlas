'use client';
import { ExplorerLink as Link } from './explorer-investigation';
import { useCallback, useEffect, useRef } from 'react';
import { initialExplorerSearch } from './blockchain-explorer-state';
import { SearchResultView } from './blockchain-explorer-results';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import {
	buildEntityHref,
	requestExplorerJson
} from '../../api/explorer-analytics';
import {
	buildAnalyticsLedgerPath,
	parseAnalyticsLedgerLookup
} from '../../api/explorer-record-lookup';
import { ExplorerBalanceObservations } from './explorer-balance-observations';
import styles from './explorer-entity.module.css';

export function ExplorerRecordLookup({
	collection,
	identifier
}: {
	readonly collection: 'accounts' | 'ledgers';
	readonly identifier: string;
}): React.JSX.Element {
	const search = useExplorerRequest(
		initialExplorerSearch,
		'The requested record could not be loaded.'
	);
	const ledgerController = useRef<AbortController | null>(null);
	useEffect(() => () => ledgerController.current?.abort(), []);
	const refresh = useCallback(
		() =>
			search.run(async () => {
				ledgerController.current?.abort();
				const controller = new AbortController();
				ledgerController.current = controller;
				try {
					const response = await requestExplorerJson(
						buildAnalyticsLedgerPath(identifier),
						controller.signal
					);
					return parseAnalyticsLedgerLookup(identifier, response);
				} finally {
					if (ledgerController.current === controller)
						ledgerController.current = null;
				}
			}),
		[search.run, identifier]
	);
	useEffect(() => {
		if (collection === 'ledgers') void refresh();
	}, [collection, refresh]);
	const filter: Readonly<Record<string, string>> =
		collection === 'accounts'
			? { source_account: identifier }
			: { min_ledger: identifier, max_ledger: identifier };
	return (
		<div className={styles.workspace}>
			<ExplorerEntityNavigation active={collection} />
			<section className={styles.panel}>
				<h2>
					{collection === 'accounts' ? 'Account' : 'Ledger'} {identifier}
				</h2>
				{collection === 'ledgers' ? (
					<>
						<ExplorerRequestNotice
							error={search.error}
							loading={search.loading}
							onRetry={() => void refresh()}
						/>
						<SearchResultView result={search.result} />
					</>
				) : null}
				<div className={styles.actions}>
					<Link href={buildEntityHref('operations', undefined, filter)}>
						Operations
					</Link>
					{collection === 'accounts' ? (
						<>
							<Link
								href={buildEntityHref('transfers', undefined, {
									account: identifier
								})}
							>
								Transfers
							</Link>
							<Link
								href={buildEntityHref('offers', undefined, {
									seller: identifier
								})}
							>
								Offer history
							</Link>
							<Link
								href={buildEntityHref('trades', undefined, {
									seller: identifier
								})}
							>
								Trades as seller
							</Link>
							<Link
								href={buildEntityHref('trades', undefined, {
									buyer: identifier
								})}
							>
								Trades as buyer
							</Link>
						</>
					) : null}
				</div>
			</section>
			{collection === 'accounts' && (
				<ExplorerBalanceObservations
					key={identifier}
					autoLoad
					kind="balances"
					identifier={identifier}
				/>
			)}
		</div>
	);
}
