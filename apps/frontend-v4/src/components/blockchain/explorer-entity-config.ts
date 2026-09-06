import type { AnalyticsCollection } from '../../api/explorer-analytics';
export interface EntityField {
	readonly key: string;
	readonly label: string;
	readonly placeholder?: string;
	readonly type?: string;
}
export const entityDescriptions: Readonly<Record<AnalyticsCollection, string>> =
	{
		operations:
			'Actions inside transactions: payments, account changes, trades and contract invocations.',
		assets:
			'Issued and native assets observed in parsed history. Open an asset to follow its transfers, trades and offers.',
		contracts:
			'Contracts observed in parsed history. Open a contract to inspect decoded events and state changes.',
		trades:
			'Executed trades, with the two assets, counterparties, amounts and execution time.',
		offers:
			'Historical offer changes: seller, asset pair, amount, price and removal status. This is not a live order book.'
	};
export const entityFields: Readonly<
	Record<AnalyticsCollection, readonly EntityField[]>
> = {
	operations: [
		{ key: 'source_account', label: 'Source account', placeholder: 'G…' },
		{
			key: 'type',
			label: 'Operation type',
			placeholder: 'payment, invoke_host_function…'
		}
	],
	assets: [
		{ key: 'asset_code', label: 'Asset code', placeholder: 'USDC' },
		{ key: 'asset_issuer', label: 'Issuer', placeholder: 'G…' }
	],
	contracts: [],
	trades: [
		{ key: 'seller', label: 'Seller', placeholder: 'G…' },
		{ key: 'buyer', label: 'Buyer', placeholder: 'G…' },
		{
			key: 'selling_asset',
			label: 'Selling asset',
			placeholder: 'native or CODE:ISSUER'
		},
		{
			key: 'buying_asset',
			label: 'Buying asset',
			placeholder: 'native or CODE:ISSUER'
		},
		{ key: 'operation_id', label: 'Operation ID' }
	],
	offers: [
		{ key: 'seller', label: 'Seller', placeholder: 'G…' },
		{ key: 'offer_id', label: 'Offer ID' },
		{
			key: 'selling_asset',
			label: 'Selling asset',
			placeholder: 'native or CODE:ISSUER'
		},
		{
			key: 'buying_asset',
			label: 'Buying asset',
			placeholder: 'native or CODE:ISSUER'
		}
	]
};
export const windowFields: readonly EntityField[] = [
	{
		key: 'min_ledger',
		label: 'First ledger',
		placeholder: 'Latest published window by default'
	},
	{ key: 'max_ledger', label: 'Last ledger' },
	{ key: 'start_time', label: 'From time (local)', type: 'datetime-local' },
	{ key: 'end_time', label: 'Until time (local)', type: 'datetime-local' }
];
export const entityColumns: Readonly<
	Record<AnalyticsCollection, readonly [string, string][]>
> = {
	operations: [
		['id', 'Operation'],
		['type', 'Action'],
		['sourceAccount', 'Source account'],
		['transactionId', 'Transaction'],
		['ledgerSequence', 'Ledger'],
		['closedAt', 'Closed']
	],
	assets: [
		['id', 'Asset'],
		['type', 'Type'],
		['issuer', 'Issuer']
	],
	contracts: [['id', 'Contract']],
	trades: [
		['id', 'Trade'],
		['sellingAsset', 'Sold'],
		['sellingAmount', 'Amount sold'],
		['buyingAsset', 'Bought'],
		['buyingAmount', 'Amount bought'],
		['seller', 'Seller'],
		['buyer', 'Buyer'],
		['closedAt', 'Executed']
	],
	offers: [
		['id', 'Offer'],
		['seller', 'Seller'],
		['sellingAsset', 'Selling'],
		['buyingAsset', 'Buying'],
		['amount', 'Amount'],
		['price', 'Price ratio'],
		['deleted', 'State'],
		['closedAt', 'Observed']
	]
};
export const titleCase = (value: string): string =>
	value.charAt(0).toUpperCase() + value.slice(1);
