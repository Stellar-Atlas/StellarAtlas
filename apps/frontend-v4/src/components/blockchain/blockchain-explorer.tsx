'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getExplorerRecentTransactions } from '../../app/actions/network-data';
import { RecentTransactionsView } from './blockchain-explorer-results';
import { initialExplorerTransactions } from './blockchain-explorer-state';
import { ExplorerRequestNotice } from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';
import { ExplorerEntityNavigation } from './explorer-entity-navigation';
import { resolveExplorerSearch } from '../../api/explorer-search-route';
import { buildEntityHref } from '../../api/explorer-analytics';

export function BlockchainExplorer(): React.JSX.Element {
	const router = useRouter(),
		[query, setQuery] = useState(''),
		[type, setType] = useState('auto'),
		[error, setError] = useState<string | null>(null);
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
				<form
					className="explorer-search-form"
					onSubmit={(event) => {
						event.preventDefault();
						const route = resolveExplorerSearch(query, type);
						if (route) {
							setError(null);
							router.push(route);
						} else
							setError(
								'Enter a transaction hash, account or contract address, ledger or operation ID, or CODE:ISSUER asset.'
							);
					}}
				>
					<input
						aria-label="Explorer search"
						placeholder="Hash, address, ledger, operation ID, or CODE:ISSUER"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
					/>
					<select
						aria-label="Search type"
						value={type}
						onChange={(event) => setType(event.currentTarget.value)}
					>
						{[
							'auto',
							'transaction',
							'account',
							'ledger',
							'operation',
							'asset',
							'contract'
						].map((value) => (
							<option key={value} value={value}>
								{value === 'auto' ? 'Detect automatically' : value}
							</option>
						))}
					</select>
					<button type="submit" disabled={!query.trim()}>
						Search
					</button>
				</form>
				{error && <p role="alert">{error}</p>}
			</section>
			<section
				className="explorer-panel explorer-feed-panel"
				aria-label="Browse transactions"
				aria-busy={feed.loading}
			>
				<div className="panel-heading explorer-feed-heading">
					<div>
						<h2>Recent transactions</h2>
						<span>Freshness and the supplying source are reported below.</span>
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
						onInspect={(hash) =>
							router.push(buildEntityHref('transactions', hash))
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
