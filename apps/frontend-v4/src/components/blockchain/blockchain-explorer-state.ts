import type {
	ExplorerAssetsResult,
	ExplorerContractResult,
	ExplorerLocalReadModelResult,
	ExplorerOperationsResult,
	ExplorerSearchResult,
	ExplorerTransactionsResult
} from '../../app/actions/network-data';
import type { PublicExplorerSearchType } from '@api/types';

export const explorerSearchTypes: readonly PublicExplorerSearchType[] = [
	'auto',
	'transaction',
	'account',
	'ledger',
	'asset',
	'contract'
];

export const initialExplorerSearch: ExplorerSearchResult = {
	message: null,
	observedAt: null,
	search: null,
	status: 'invalid'
};

export const initialExplorerOperations: ExplorerOperationsResult = {
	message: null,
	observedAt: null,
	operations: null,
	status: 'invalid'
};

export const initialExplorerAssets: ExplorerAssetsResult = {
	assets: null,
	message: null,
	observedAt: null,
	status: 'invalid'
};

export const initialExplorerContract: ExplorerContractResult = {
	contract: null,
	message: null,
	observedAt: null,
	status: 'invalid'
};

export const initialExplorerTransactions: ExplorerTransactionsResult = {
	message: null,
	status: 'invalid',
	transactions: null
};

export const initialExplorerReadModel: ExplorerLocalReadModelResult = {
	message: null,
	readModel: null,
	status: 'invalid'
};
