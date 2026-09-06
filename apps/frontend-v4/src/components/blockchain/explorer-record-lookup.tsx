'use client';
import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import { searchExplorer } from '../../app/actions/network-data';
import { initialExplorerSearch } from './blockchain-explorer-state';
import { SearchResultView } from './blockchain-explorer-results';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { buildEntityHref } from '../../api/explorer-analytics';
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
	const refresh = useCallback(
		() =>
			search.run(() =>
				searchExplorer(
					identifier,
					collection === 'accounts' ? 'account' : 'ledger'
				)
			),
		[search.run, identifier, collection]
	);
	useEffect(() => {
		void refresh();
	}, [refresh]);
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
				<ExplorerRequestNotice
					error={search.error}
					loading={search.loading}
					onRetry={() => void refresh()}
				/>
				<SearchResultView result={search.result} />
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
		</div>
	);
}
