'use client';

import { useEffect, useState } from 'react';
import {
	getExplorerRecentTransactions,
	lookupExplorerContract,
	searchExplorer,
	searchExplorerAssets,
	searchExplorerOperations,
	type ExplorerAssetsResult,
	type ExplorerContractResult,
	type ExplorerOperationsResult,
	type ExplorerSearchResult,
	type ExplorerTransactionsResult
} from '../../app/actions/network-data';
import type {
	PublicExplorerOperationFilters,
	PublicExplorerSearchType
} from '@api/types';
import { stellarOperationTypes } from '../../domain/stellar-operation-types';
import {
	AssetsView,
	ContractView,
	OperationsView,
	RecentTransactionsView,
	SearchResultView,
	toDateInputValue
} from './blockchain-explorer-results';

const searchTypeOptions: readonly PublicExplorerSearchType[] = [
	'auto',
	'transaction',
	'account',
	'ledger',
	'asset',
	'contract'
];

const initialSearch: ExplorerSearchResult = {
	message: null,
	search: null,
	status: 'invalid'
};

const initialOperations: ExplorerOperationsResult = {
	message: null,
	operations: null,
	status: 'invalid'
};

const initialAssets: ExplorerAssetsResult = {
	assets: null,
	message: null,
	status: 'invalid'
};

const initialContract: ExplorerContractResult = {
	contract: null,
	message: null,
	status: 'invalid'
};

const initialTransactions: ExplorerTransactionsResult = {
	message: null,
	status: 'invalid',
	transactions: null
};

export function BlockchainExplorer(): React.JSX.Element {
	const [searchQuery, setSearchQuery] = useState('');
	const [searchType, setSearchType] =
		useState<PublicExplorerSearchType>('auto');
	const [searchResult, setSearchResult] = useState(initialSearch);
	const [operationFilters, setOperationFilters] =
		useState<PublicExplorerOperationFilters>({});
	const [operationResult, setOperationResult] = useState(initialOperations);
	const [assetCode, setAssetCode] = useState('');
	const [assetIssuer, setAssetIssuer] = useState('');
	const [assetResult, setAssetResult] = useState(initialAssets);
	const [contractId, setContractId] = useState('');
	const [contractResult, setContractResult] = useState(initialContract);
	const [transactionFeed, setTransactionFeed] = useState(initialTransactions);
	const [loading, setLoading] = useState<string | null>(null);
	const [transactionFeedLoading, setTransactionFeedLoading] = useState(false);

	const runExplorerSearch = (
		query: string,
		type: PublicExplorerSearchType
	): void => {
		setLoading('search');
		void searchExplorer(query, type)
			.then(setSearchResult)
			.finally(() => setLoading(null));
	};

	const loadRecentTransactions = (): void => {
		setTransactionFeedLoading(true);
		void getExplorerRecentTransactions(20)
			.then(setTransactionFeed)
			.finally(() => setTransactionFeedLoading(false));
	};

	const inspectTransaction = (hash: string): void => {
		setSearchQuery(hash);
		setSearchType('transaction');
		runExplorerSearch(hash, 'transaction');
	};

	useEffect(() => {
		loadRecentTransactions();
	}, []);

	const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		runExplorerSearch(searchQuery, searchType);
	};

	const submitOperations = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('operations');
		void searchExplorerOperations(operationFilters)
			.then(setOperationResult)
			.finally(() => setLoading(null));
	};

	const submitAssets = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('assets');
		void searchExplorerAssets(assetCode, assetIssuer)
			.then(setAssetResult)
			.finally(() => setLoading(null));
	};

	const submitContract = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('contract');
		void lookupExplorerContract(contractId)
			.then(setContractResult)
			.finally(() => setLoading(null));
	};

	return (
		<section className="blockchain-explorer-workspace">
			<section className="explorer-panel explorer-primary">
				<div className="panel-heading">
					<div>
						<strong>Search</strong>
						<span>Transaction, address, ledger, asset, or contract</span>
					</div>
				</div>
				<form className="explorer-search-form" onSubmit={submitSearch}>
					<input
						aria-label="Explorer search"
						onChange={(event) => setSearchQuery(event.currentTarget.value)}
						placeholder="Hash, G address, ledger, asset code, contract"
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
						{searchTypeOptions.map((type) => (
							<option key={type} value={type}>
								{type}
							</option>
						))}
					</select>
					<button disabled={loading === 'search'} type="submit">
						{loading === 'search' ? 'Searching' : 'Search'}
					</button>
				</form>
				<SearchResultView result={searchResult} />
			</section>

			<section className="explorer-panel explorer-feed-panel">
				<div className="panel-heading explorer-feed-heading">
					<div>
						<strong>Recent Transactions</strong>
						<span>Latest Horizon transactions</span>
					</div>
					<button
						disabled={transactionFeedLoading}
						onClick={loadRecentTransactions}
						type="button"
					>
						{transactionFeedLoading ? 'Loading' : 'Refresh'}
					</button>
				</div>
				<RecentTransactionsView
					onInspect={inspectTransaction}
					result={transactionFeed}
				/>
			</section>

			<section className="explorer-grid">
				<section className="explorer-panel">
					<div className="panel-heading">
						<div>
							<strong>Operations</strong>
							<span>Ledger, address, type, and date filters</span>
						</div>
					</div>
					<form className="explorer-filter-form" onSubmit={submitOperations}>
						<ExplorerInput
							label="Ledger"
							onChange={(value) =>
								setOperationFilters((filters) => ({
									...filters,
									ledger: value || undefined
								}))
							}
							value={operationFilters.ledger ?? ''}
						/>
						<ExplorerInput
							label="Address"
							onChange={(value) =>
								setOperationFilters((filters) => ({
									...filters,
									accountId: value || undefined
								}))
							}
							value={operationFilters.accountId ?? ''}
						/>
						<label>
							<span>Type</span>
							<select
								onChange={(event) => {
									const value = event.currentTarget.value;
									setOperationFilters((filters) => ({
										...filters,
										operationType: value || undefined
									}));
								}}
								value={operationFilters.operationType ?? ''}
							>
								{stellarOperationTypes.map((type) => (
									<option key={type || 'all'} value={type}>
										{type || 'all'}
									</option>
								))}
							</select>
						</label>
						<ExplorerInput
							label="From"
							onChange={(value) =>
								setOperationFilters((filters) => ({
									...filters,
									from: value ? new Date(value).toISOString() : undefined
								}))
							}
							type="datetime-local"
							value={toDateInputValue(operationFilters.from)}
						/>
						<ExplorerInput
							label="To"
							onChange={(value) =>
								setOperationFilters((filters) => ({
									...filters,
									to: value ? new Date(value).toISOString() : undefined
								}))
							}
							type="datetime-local"
							value={toDateInputValue(operationFilters.to)}
						/>
						<button disabled={loading === 'operations'} type="submit">
							{loading === 'operations' ? 'Loading' : 'Load'}
						</button>
					</form>
					<OperationsView result={operationResult} />
				</section>

				<section className="explorer-panel">
					<div className="panel-heading">
						<div>
							<strong>Assets</strong>
							<span>Asset code and issuer search</span>
						</div>
					</div>
					<form className="explorer-filter-form" onSubmit={submitAssets}>
						<ExplorerInput
							label="Code"
							onChange={setAssetCode}
							value={assetCode}
						/>
						<ExplorerInput
							label="Issuer"
							onChange={setAssetIssuer}
							value={assetIssuer}
						/>
						<button disabled={loading === 'assets'} type="submit">
							{loading === 'assets' ? 'Loading' : 'Find'}
						</button>
					</form>
					<AssetsView result={assetResult} />
				</section>

				<section className="explorer-panel">
					<div className="panel-heading">
						<div>
							<strong>Contracts</strong>
							<span>RPC-backed status</span>
						</div>
					</div>
					<form className="explorer-filter-form" onSubmit={submitContract}>
						<ExplorerInput
							label="Contract"
							onChange={setContractId}
							value={contractId}
						/>
						<button disabled={loading === 'contract'} type="submit">
							{loading === 'contract' ? 'Checking' : 'Check'}
						</button>
					</form>
					<ContractView result={contractResult} />
				</section>
			</section>
		</section>
	);
}

function ExplorerInput({
	label,
	onChange,
	type = 'text',
	value
}: {
	readonly label: string;
	readonly onChange: (value: string) => void;
	readonly type?: string;
	readonly value: string;
}): React.JSX.Element {
	return (
		<label>
			<span>{label}</span>
			<input
				onChange={(event) => onChange(event.currentTarget.value)}
				type={type}
				value={value}
			/>
		</label>
	);
}
