'use client';
import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getExplorerRecentTransactions } from '../../app/actions/network-data';
import { RecentTransactionsView } from './blockchain-explorer-results';
import { initialExplorerTransactions } from './blockchain-explorer-state';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { ExplorerSearchForm } from './explorer-search-form';
import { buildEntityHref } from '../../api/explorer-analytics';

export function BlockchainExplorer(): React.JSX.Element {
	const router = useRouter();
	const feed = useExplorerRequest(
		initialExplorerTransactions,
		'Transaction data could not be refreshed.'
	);
	const refresh = useCallback(
		() => feed.run(() => getExplorerRecentTransactions(20)),
		[feed.run]
	);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	return (
		<section className="blockchain-explorer-workspace">
			<ExplorerEntityNavigation active="transactions" />
			<section
				className="explorer-panel explorer-primary"
				aria-label="Search blockchain"
			>
				<h2>Search the blockchain</h2>
				<p>
					Open a transaction, account, ledger, operation, asset, or contract.
					Browse the parsed history using the sections above.
				</p>
				<ExplorerSearchForm />
			</section>
			<section
				className="explorer-panel explorer-feed-panel"
				aria-label="Browse transactions"
				aria-busy={feed.loading}
			>
				<div className="panel-heading explorer-feed-heading">
					<div>
						<h2>Latest available transactions</h2>
						<span>
							Open a record to inspect its operations, events and related
							accounts.
						</span>
					</div>
					<button disabled={feed.loading} onClick={() => void refresh()}>
						Refresh
					</button>
				</div>
				<ExplorerRequestNotice
					error={feed.error}
					loading={feed.loading}
					onRetry={() => void refresh()}
				/>
				{feed.result.transactions !== null ? (
					<RecentTransactionsView
						onInspect={(hash, ledger) =>
							router.push(
								buildEntityHref('transactions', hash, {
									ledger_sequence: ledger
								})
							)
						}
						result={feed.result}
					/>
				) : !feed.loading && !feed.error ? (
					<p>No transaction records returned.</p>
				) : null}
			</section>
		</section>
	);
}
