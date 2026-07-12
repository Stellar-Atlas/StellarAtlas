'use client';

import { useEffect, useState, useTransition } from 'react';
import {
	getExplorerRecentTransactions,
	getExplorerInitialData,
	getExplorerTransactionOperations,
	lookupExplorerContract,
	searchExplorer,
	searchExplorerAssets,
	searchExplorerOperations,
	type ExplorerSearchResult
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
import { ExplorerLocalReadModelWatermark } from './explorer-local-read-model-watermark';
import {
	explorerSearchTypes,
	initialExplorerAssets,
	initialExplorerContract,
	initialExplorerOperations,
	initialExplorerReadModel,
	initialExplorerSearch,
	initialExplorerTransactions
} from './blockchain-explorer-state';

export function BlockchainExplorer(): React.JSX.Element {
	const [searchQuery, setSearchQuery] = useState('');
	const [searchType, setSearchType] =
		useState<PublicExplorerSearchType>('auto');
	const [searchResult, setSearchResult] = useState(initialExplorerSearch);
	const [operationFilters, setOperationFilters] =
		useState<PublicExplorerOperationFilters>({});
	const [operationResult, setOperationResult] = useState(
		initialExplorerOperations
	);
	const [assetCode, setAssetCode] = useState('');
	const [assetIssuer, setAssetIssuer] = useState('');
	const [assetResult, setAssetResult] = useState(initialExplorerAssets);
	const [contractId, setContractId] = useState('');
	const [contractResult, setContractResult] = useState(initialExplorerContract);
	const [transactionFeed, setTransactionFeed] = useState(
		initialExplorerTransactions
	);
	const [localReadModel, setLocalReadModel] = useState(
		initialExplorerReadModel
	);
	const [transactionOperations, setTransactionOperations] = useState(
		initialExplorerOperations
	);
	const [loading, setLoading] = useState<string | null>(null);
	const [transactionOperationsLoading, setTransactionOperationsLoading] =
		useState(false);
	const [transactionFeedLoading, setTransactionFeedLoading] = useState(false);
	const [, startTransition] = useTransition();
	const indexReadiness = localReadModel.readModel?.indexes;
	const operationIndexReady = Boolean(indexReadiness?.operationIndexReady);
	const assetIndexReady = Boolean(indexReadiness?.assetIndexReady);
	const contractIndexReady = Boolean(indexReadiness?.contractIndexReady);
	const availableSearchTypes = explorerSearchTypes.filter(
		(type) =>
			(type !== 'asset' || assetIndexReady) &&
			(type !== 'contract' || contractIndexReady)
	);

	const runExplorerSearch = (
		query: string,
		type: PublicExplorerSearchType
	): void => {
		setLoading('search');
		startTransition(async () => {
			try {
				const result = await searchExplorer(query, type);
				setSearchResult(result);
				const transactionHash = getTransactionHashFromSearch(result);
				if (transactionHash && operationIndexReady) {
					loadTransactionOperations(transactionHash);
				} else {
					setTransactionOperations(initialExplorerOperations);
				}
			} finally {
				setLoading(null);
			}
		});
	};

	const loadTransactionOperations = (hash: string): void => {
		setTransactionOperationsLoading(true);
		startTransition(async () => {
			try {
				setTransactionOperations(await getExplorerTransactionOperations(hash));
			} finally {
				setTransactionOperationsLoading(false);
			}
		});
	};

	const loadRecentTransactions = (): void => {
		setTransactionFeedLoading(true);
		startTransition(async () => {
			try {
				setTransactionFeed(await getExplorerRecentTransactions(20));
			} finally {
				setTransactionFeedLoading(false);
			}
		});
	};

	const inspectTransaction = (hash: string): void => {
		setSearchQuery(hash);
		setSearchType('transaction');
		runExplorerSearch(hash, 'transaction');
	};

	useEffect(() => {
		setTransactionFeedLoading(true);
		startTransition(async () => {
			try {
				const initialData = await getExplorerInitialData(20);
				setLocalReadModel(initialData.readModel);
				setTransactionFeed(initialData.transactions);
			} finally {
				setTransactionFeedLoading(false);
			}
		});
	}, []);

	const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		runExplorerSearch(searchQuery, searchType);
	};

	const submitOperations = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('operations');
		startTransition(async () => {
			try {
				setOperationResult(await searchExplorerOperations(operationFilters));
			} finally {
				setLoading(null);
			}
		});
	};

	const submitAssets = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('assets');
		startTransition(async () => {
			try {
				setAssetResult(await searchExplorerAssets(assetCode, assetIssuer));
			} finally {
				setLoading(null);
			}
		});
	};

	const submitContract = (event: React.FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		setLoading('contract');
		startTransition(async () => {
			try {
				setContractResult(await lookupExplorerContract(contractId));
			} finally {
				setLoading(null);
			}
		});
	};

	return (
		<section className="blockchain-explorer-workspace">
			<ExplorerLocalReadModelWatermark result={localReadModel} />

			<section className="explorer-panel explorer-primary">
				<div className="panel-heading">
					<div>
						<strong>Search</strong>
						<span>
							Search results identify their data source and observation time.
						</span>
					</div>
				</div>
				<form className="explorer-search-form" onSubmit={submitSearch}>
					<input
						aria-label="Explorer search"
						onChange={(event) => setSearchQuery(event.currentTarget.value)}
						placeholder="Transaction hash, G address, ledger, asset code, contract"
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
								{formatSearchTypeOption(type)}
							</option>
						))}
					</select>
					<button disabled={loading === 'search'} type="submit">
						{loading === 'search' ? 'Searching' : 'Search'}
					</button>
				</form>
				<SearchResultView result={searchResult} />
				{transactionOperations.status !== 'invalid' ? (
					<div className="explorer-linked-operations">
						<div className="panel-heading compact">
							<div>
								<strong>Transaction Operations</strong>
								<span>
									{transactionOperationsLoading
										? 'Loading operation rows'
										: 'Operations for the selected transaction'}
								</span>
							</div>
						</div>
						<OperationsView result={transactionOperations} />
					</div>
				) : null}
			</section>

			<section className="explorer-panel explorer-feed-panel">
				<div className="panel-heading explorer-feed-heading">
					<div>
						<strong>Latest indexed transactions</strong>
						<span>
							{transactionFeed.transactions?.source === 'postgres_canonical'
								? 'Latest proof-gated rows in StellarAtlas canonical history'
								: 'Current transaction sample from the Stellar public network'}
						</span>
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
							<span>
								{operationIndexReady
									? 'Local operation index available'
									: 'Local operation index is not available yet'}
							</span>
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
							disabled={!operationIndexReady}
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
							disabled={!operationIndexReady}
							value={operationFilters.accountId ?? ''}
						/>
						<label>
							<span>Type</span>
							<select
								disabled={!operationIndexReady}
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
							disabled={!operationIndexReady}
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
							disabled={!operationIndexReady}
							value={toDateInputValue(operationFilters.to)}
						/>
						<button
							disabled={!operationIndexReady || loading === 'operations'}
							type="submit"
						>
							{loading === 'operations' ? 'Loading' : 'Load'}
						</button>
					</form>
					{operationIndexReady ? null : (
						<p className="explorer-state neutral">
							Operation filters require the decoded operation index. Transaction
							hash lookup remains available above.
						</p>
					)}
					<OperationsView result={operationResult} />
				</section>

				<section className="explorer-panel">
					<div className="panel-heading">
						<div>
							<strong>Assets</strong>
							<span>
								{assetIndexReady
									? 'Local asset index available'
									: 'Local asset index is not available yet'}
							</span>
						</div>
					</div>
					<form className="explorer-filter-form" onSubmit={submitAssets}>
						<ExplorerInput
							label="Code"
							disabled={!assetIndexReady}
							onChange={setAssetCode}
							value={assetCode}
						/>
						<ExplorerInput
							label="Issuer"
							disabled={!assetIndexReady}
							onChange={setAssetIssuer}
							value={assetIssuer}
						/>
						<button
							disabled={!assetIndexReady || loading === 'assets'}
							type="submit"
						>
							{loading === 'assets' ? 'Loading' : 'Find'}
						</button>
					</form>
					{assetIndexReady ? null : (
						<p className="explorer-state neutral">
							Asset search requires the local decoded asset index.
						</p>
					)}
					<AssetsView result={assetResult} />
				</section>

				<section className="explorer-panel">
					<div className="panel-heading">
						<div>
							<strong>Contracts</strong>
							<span>
								{contractIndexReady
									? 'Local contract index available'
									: 'Local contract index is not available yet'}
							</span>
						</div>
					</div>
					<form className="explorer-filter-form" onSubmit={submitContract}>
						<ExplorerInput
							label="Contract"
							disabled={!contractIndexReady}
							onChange={setContractId}
							value={contractId}
						/>
						<button
							disabled={!contractIndexReady || loading === 'contract'}
							type="submit"
						>
							{loading === 'contract' ? 'Checking' : 'Lookup'}
						</button>
					</form>
					{contractIndexReady ? null : (
						<p className="explorer-state neutral">
							Contract search requires the local decoded contract index.
						</p>
					)}
					<ContractView result={contractResult} />
				</section>
			</section>
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
	) {
		return null;
	}

	return value.hash;
}

function formatSearchTypeOption(type: PublicExplorerSearchType): string {
	return type;
}

function ExplorerInput({
	disabled = false,
	label,
	onChange,
	type = 'text',
	value
}: {
	readonly disabled?: boolean;
	readonly label: string;
	readonly onChange: (value: string) => void;
	readonly type?: string;
	readonly value: string;
}): React.JSX.Element {
	return (
		<label>
			<span>{label}</span>
			<input
				disabled={disabled}
				onChange={(event) => onChange(event.currentTarget.value)}
				type={type}
				value={value}
			/>
		</label>
	);
}
