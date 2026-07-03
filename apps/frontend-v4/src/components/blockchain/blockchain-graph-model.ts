import type {
	PublicLedgerTransaction,
	PublicLedgerTransactions,
	PublicLatestLedger
} from '@api/types';

export type BlockchainGraphNodeType = 'account' | 'ledger' | 'transaction';

export interface BlockchainGraphNode {
	readonly detail: string;
	readonly id: string;
	readonly label: string;
	readonly tone: 'blue' | 'green' | 'red' | 'yellow';
	readonly type: BlockchainGraphNodeType;
	readonly x: number;
	readonly y: number;
}

export interface BlockchainGraphEdge {
	readonly id: string;
	readonly label: string;
	readonly source: string;
	readonly target: string;
	readonly tone: 'blue' | 'green' | 'red' | 'yellow';
}

export interface BlockchainGraphMetric {
	readonly label: string;
	readonly value: string;
}

export interface BlockchainGraphModel {
	readonly edges: readonly BlockchainGraphEdge[];
	readonly metrics: readonly BlockchainGraphMetric[];
	readonly nodes: readonly BlockchainGraphNode[];
	readonly records: readonly PublicLedgerTransaction[];
}

const maxVisibleTransactions = 8;

const shortenMiddle = (value: string, prefix = 8, suffix = 5): string =>
	value.length > prefix + suffix + 3
		? `${value.slice(0, prefix)}...${value.slice(-suffix)}`
		: value;

const getTransactionPosition = (
	index: number,
	count: number
): { x: number; y: number } => {
	const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1);
	return {
		x: 50 + Math.cos(angle) * 22,
		y: 38 + Math.sin(angle) * 16
	};
};

const getAccountPosition = (
	index: number,
	count: number
): { x: number; y: number } => {
	const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(count, 1);
	return {
		x: 50 + Math.cos(angle) * 34,
		y: 38 + Math.sin(angle) * 23
	};
};

export const buildBlockchainGraphModel = (
	latestLedger: PublicLatestLedger,
	transactions: PublicLedgerTransactions
): BlockchainGraphModel => {
	const visibleRecords = transactions.records.slice(0, maxVisibleTransactions);
	const sourceAccounts = Array.from(
		new Set(visibleRecords.map((record) => record.sourceAccount))
	);
	const accountIndex = new Map(
		sourceAccounts.map((accountId, index) => [accountId, index])
	);
	const accountCount = Math.max(sourceAccounts.length, 1);
	const nodes: BlockchainGraphNode[] = [
		{
			detail: `${latestLedger.protocolVersion} protocol`,
			id: `ledger:${transactions.ledger}`,
			label: 'Ledger',
			tone: 'yellow',
			type: 'ledger',
			x: 50,
			y: 38
		},
		...visibleRecords.map((record, index) => {
			const position = getTransactionPosition(index, visibleRecords.length);
			return {
				...position,
				detail: `${record.operationCount} ops / fee ${record.feeCharged}`,
				id: `transaction:${record.hash}`,
				label: `Tx ${index + 1}`,
				tone: record.successful ? ('green' as const) : ('red' as const),
				type: 'transaction' as const
			};
		}),
		...sourceAccounts.map((accountId) => {
			const index = accountIndex.get(accountId) ?? 0;
			const position = getAccountPosition(index, accountCount);
			return {
				...position,
				detail: shortenMiddle(accountId, 10, 6),
				id: `account:${accountId}`,
				label: `Account ${index + 1}`,
				tone: 'blue' as const,
				type: 'account' as const
			};
		})
	];
	const edges: BlockchainGraphEdge[] = visibleRecords.flatMap(
		(record, index) => [
			{
				id: `ledger-transaction:${record.hash}`,
				label: 'contains',
				source: `ledger:${transactions.ledger}`,
				target: `transaction:${record.hash}`,
				tone: record.successful ? ('green' as const) : ('red' as const)
			},
			{
				id: `account-transaction:${record.hash}:${index}`,
				label: 'submitted',
				source: `account:${record.sourceAccount}`,
				target: `transaction:${record.hash}`,
				tone: 'blue' as const
			}
		]
	);

	return {
		edges,
		metrics: [
			{ label: 'Ledger', value: transactions.ledger },
			{ label: 'Closed', value: latestLedger.closedAt },
			{ label: 'Transactions', value: transactions.records.length.toString() },
			{ label: 'Source accounts', value: sourceAccounts.length.toString() }
		],
		nodes,
		records: visibleRecords
	};
};
