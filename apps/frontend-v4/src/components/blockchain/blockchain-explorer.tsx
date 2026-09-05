'use client';

import { useCallback, useEffect, useState } from 'react';
import {
	getExplorerRecentTransactions,
	getExplorerInitialData,
	getExplorerTransactionOperations,
	searchExplorer,
	type ExplorerSearchResult
} from '../../app/actions/network-data';
import type { PublicExplorerSearchType } from '@api/types';
import {
	OperationsView,
	RecentTransactionsView,
	SearchResultView
} from './blockchain-explorer-results';
import {
	explorerSearchTypes,
	initialExplorerOperations,
	initialExplorerReadModel,
	initialExplorerSearch,
	initialExplorerTransactions
} from './blockchain-explorer-state';
import {
	ExplorerAssetsPanel,
	ExplorerContractsPanel,
	ExplorerOperationsPanel
} from './explorer-browse-panels';
import {
	ExplorerBrowseNavigation,
	ExplorerRequestNotice,
	type ExplorerBrowseSection
} from './explorer-browse-ui';
import { useExplorerRequest } from './use-explorer-request';

const initialData = {
	readModel: initialExplorerReadModel,
	transactions: initialExplorerTransactions
};

export function BlockchainExplorer(): React.JSX.Element {
	const [section, setSection] = useState<ExplorerBrowseSection>('Transactions');
	const [searchQuery, setSearchQuery] = useState('');
	const [searchType, setSearchType] =
		useState<PublicExplorerSearchType>('auto');
	const search = useExplorerRequest(
		initialExplorerSearch,
		'Search could not be completed. Please try again.'
	);
	const feed = useExplorerRequest(
		initialExplorerTransactions,
		'Transaction data could not be refreshed.'
	);
	const linked = useExplorerRequest(
		initialExplorerOperations,
		'Transaction operations could not be loaded.'
	);
	const bootstrap = useExplorerRequest(
		initialData,
		'Explorer availability could not be checked.'
	);
	const readiness = bootstrap.result.readModel.readModel?.indexes;
	const operationIndexReady = Boolean(readiness?.operationIndexReady);
	const availableSearchTypes = explorerSearchTypes.filter(
		(type) =>
			(type !== 'asset' || readiness?.assetIndexReady) &&
			(type !== 'contract' || readiness?.contractIndexReady)
	);
	const loadInitial = useCallback(async () => {
		const data = await bootstrap.run(() => getExplorerInitialData(20));
		if (data !== null) feed.accept(data.transactions);
	}, [bootstrap.run, feed.accept]);
	useEffect(() => {
		void loadInitial();
	}, [loadInitial]);

	const runSearch = async (
		query: string,
		type: PublicExplorerSearchType
	): Promise<void> => {
		const result = await search.run(() => searchExplorer(query, type));
		if (result === null) return;
		const hash = getTransactionHashFromSearch(result);
		linked.accept(initialExplorerOperations);
		if (hash !== null && operationIndexReady) {
			void linked.run(() => getExplorerTransactionOperations(hash));
		}
	};
	const inspectTransaction = (hash: string): void => {
		setSearchQuery(hash);
		setSearchType('transaction');
		void runSearch(hash, 'transaction');
	};
	const readinessError =
		bootstrap.error ??
		(bootstrap.result.readModel.status === 'unavailable'
			? bootstrap.result.readModel.message
			: null);

	return (
		<section className="blockchain-explorer-workspace">
			<section
				className="explorer-panel explorer-primary"
				aria-label="Search blockchain"
				aria-busy={search.loading}
			>
				<div className="panel-heading">
					<div>
						<h2>Search the blockchain</h2>
						<span>
							Find a transaction, account, or ledger by its identifier
						</span>
					</div>
				</div>
				<form
					className="explorer-search-form"
					onSubmit={(event) => {
						event.preventDefault();
						void runSearch(searchQuery.trim(), searchType);
					}}
				>
					<input
						aria-label="Explorer search"
						onChange={(event) => setSearchQuery(event.currentTarget.value)}
						placeholder="Transaction hash, account address, or ledger number"
						value={searchQuery}
					/>
					<select
						aria-label="Search type"
						onChange={(event) =>
							setSearchType(
								event.currentTarget.value as PublicExplorerSearchType
							)
						}
						value={searchType}
					>
						{availableSearchTypes.map((type) => (
							<option key={type} value={type}>
								{type === 'auto' ? 'Detect automatically' : type}
							</option>
						))}
					</select>
					<button
						disabled={search.loading || !searchQuery.trim()}
						type="submit"
					>
						{search.loading ? 'Searching' : 'Search'}
					</button>
				</form>
				<ExplorerRequestNotice
					error={search.error}
					loading={search.loading}
					onRetry={() => {
						void runSearch(searchQuery.trim(), searchType);
					}}
				/>
				<SearchResultView result={search.result} />
				{linked.result.status !== 'invalid' ||
				linked.loading ||
				linked.error !== null ? (
					<div
						className="explorer-linked-operations"
						aria-busy={linked.loading}
					>
						<h3>Transaction operations</h3>
						<ExplorerRequestNotice
							error={linked.error}
							loading={linked.loading}
							onRetry={linked.retry}
						/>
						<OperationsView result={linked.result} />
					</div>
				) : null}
			</section>
			<ExplorerBrowseNavigation active={section} onChange={setSection} />
			<ExplorerRequestNotice
				error={readinessError}
				loading={false}
				onRetry={() => {
					void loadInitial();
				}}
			/>
			<div hidden={section !== 'Transactions'}>
				<section
					className="explorer-panel explorer-feed-panel"
					aria-label="Browse transactions"
					aria-busy={feed.loading || bootstrap.loading}
				>
					<div className="panel-heading explorer-feed-heading">
						<div>
							<h2>Recent transactions</h2>
							<span>
								Available records; freshness and source are reported below
							</span>
						</div>
						<button
							disabled={feed.loading || bootstrap.loading}
							onClick={() => {
								void feed.run(() => getExplorerRecentTransactions(20));
							}}
							type="button"
						>
							Refresh
						</button>
					</div>
					<ExplorerRequestNotice
						error={feed.error}
						loading={feed.loading || bootstrap.loading}
						onRetry={() => {
							void feed.run(() => getExplorerRecentTransactions(20));
						}}
					/>
					{feed.result.transactions !== null ? (
						<RecentTransactionsView
							onInspect={inspectTransaction}
							result={feed.result}
						/>
					) : !feed.loading && !bootstrap.loading && feed.error === null ? (
						<p className="explorer-state neutral">
							No transaction data loaded. Refresh to try again.
						</p>
					) : null}
				</section>
			</div>
			<div hidden={section !== 'Operations'}>
				<ExplorerOperationsPanel
					ready={operationIndexReady}
					checking={bootstrap.loading}
					onCheck={() => {
						void loadInitial();
					}}
				/>
			</div>
			<div hidden={section !== 'Assets'}>
				<ExplorerAssetsPanel
					ready={Boolean(readiness?.assetIndexReady)}
					checking={bootstrap.loading}
					onCheck={() => {
						void loadInitial();
					}}
				/>
			</div>
			<div hidden={section !== 'Contracts'}>
				<ExplorerContractsPanel
					ready={Boolean(readiness?.contractIndexReady)}
					checking={bootstrap.loading}
					onCheck={() => {
						void loadInitial();
					}}
				/>
			</div>
		</section>
	);
}

function getTransactionHashFromSearch(
	result: ExplorerSearchResult
): string | null {
	const value = result.search?.result;
	if (
		result.search?.resultType !== 'transaction' ||
		typeof value !== 'object' ||
		value === null ||
		!('hash' in value) ||
		typeof value.hash !== 'string'
	)
		return null;
	return value.hash;
}
