import { GraphQLScalarType, type GraphQLSchema } from 'graphql';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import {
	parseAsset,
	requireStellarAddress
} from './HubbleSemanticRouteHelpers.js';

export const hubbleAssetHolderSchema = `
	"""Parsed ETL number or numeric string, preserved as received. Float64 balances are observations, not reconstructed exact atomic units."""
	scalar HubbleParsedNumber
	extend type Query {
			hubbleAssetHolders(asset: String!, input: HubbleAssetHolderInput): HubbleAssetHolderPage!
			hubbleAssetBalances(asset: String!, input: HubbleAssetHolderInput): HubbleAssetHolderPage!
			hubbleAssetTrustlines(asset: String!, input: HubbleAssetHolderInput): HubbleAssetHolderPage!
		hubbleAssetHolder(asset: String!, account: String!): HubbleAssetHolderDetail!
	}
	input HubbleAssetHolderInput { after: String limit: Int sort: String order: String asOfLedger: Int includeZero: Boolean includeDeleted: Boolean }
	type HubbleAssetHolderWatermark {
		indexStatus: String
		mode: String!
		catalogGeneratedAt: String!
		catalogMaximumLedger: String
		snapshotPinned: Boolean!
		selectedLedger: String
		coverageStatus: String!
		balancePrecision: String!
	}
	type HubbleAssetHolder {
		accountId: String!
		balance: HubbleParsedNumber!
		"""Balance and liabilities originate in Float64 ETL observations; no exact stroop reconstruction is claimed."""
		amountPrecision: String!
		buyingLiabilities: HubbleParsedNumber
		sellingLiabilities: HubbleParsedNumber
		trustLineLimit: HubbleParsedNumber
		ledgerSequence: String
		lastModifiedLedger: String
		assetCode: String
		assetIssuer: String
		assetType: String
		flags: String
		sponsor: String
		sponsored: Boolean!
		deleted: Boolean!
	}
	type HubbleAssetHolderSummary { holderCount: String! balanceTotal: HubbleParsedNumber! }
	type HubbleAssetHolderPage {
		asset: String!
		holders: [HubbleAssetHolder!]!
		limit: Int!
		nextCursor: String
		elapsedMilliseconds: Float!
		coverage: HubbleLedgerCoverage!
		watermark: HubbleAssetHolderWatermark!
		indexedSummary: HubbleAssetHolderSummary
	}
	type HubbleAssetHolderDetail {
		asset: String!
		"""Null means no positive balance in the latest ingested state, not proven absence on the current chain."""
		holder: HubbleAssetHolder
		coverage: HubbleLedgerCoverage!
		watermark: HubbleAssetHolderWatermark!
	}
`;

function parsedNumber(value: unknown): string | number {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (
		typeof value === 'string' &&
		/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
	)
		return value;
	throw new HubbleWarehouseUnavailableError('Invalid parsed holder number');
}
export function configureHubbleAssetHolderScalar(schema: GraphQLSchema): void {
	const scalar = schema.getType('HubbleParsedNumber');
	if (!(scalar instanceof GraphQLScalarType))
		throw new Error('Holder numeric scalar missing');
	scalar.serialize = parsedNumber;
}
function optionalNumber(value: unknown): string | number | null {
	return value == null ? null : parsedNumber(value);
}
function optionalText(value: unknown): string | null {
	if (value == null) return null;
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isSafeInteger(value))
		return String(value);
	throw new HubbleWarehouseUnavailableError('Invalid parsed holder identifier');
}
function holder(row: Readonly<Record<string, unknown>>) {
	if (typeof row.account_id !== 'string' || row.account_id === '')
		throw new HubbleWarehouseUnavailableError(
			'Missing holder account identity'
		);
	return {
		accountId: row.account_id,
		balance: parsedNumber(row.balance),
		amountPrecision: 'float64-observation',
		buyingLiabilities: optionalNumber(row.buying_liabilities),
		sellingLiabilities: optionalNumber(row.selling_liabilities),
		trustLineLimit: optionalNumber(row.trust_line_limit),
		ledgerSequence: optionalText(row.ledger_sequence),
		lastModifiedLedger: optionalText(row.last_modified_ledger),
		assetCode: optionalText(row.asset_code),
		assetIssuer: optionalText(row.asset_issuer),
		assetType: optionalText(row.asset_type),
		flags: optionalText(row.flags),
		sponsor: optionalText(row.sponsor),
		sponsored: row.sponsored === true,
		deleted: row.deleted === true
	};
}
interface ListArguments {
	readonly asset: string;
	readonly input?: {
		readonly limit?: number | null;
		readonly after?: string | null;
		readonly sort?: string | null;
		readonly order?: string | null;
		readonly asOfLedger?: number | null;
		readonly includeZero?: boolean | null;
		readonly includeDeleted?: boolean | null;
	} | null;
}
interface DetailArguments {
	readonly asset: string;
	readonly account: string;
}
export function hubbleAssetHolderResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
) {
	const list = async (
		{ asset, input }: ListArguments,
		forceAll: boolean,
		requireIssued: boolean
	) => {
		try {
			const limit = input?.limit ?? 100;
			const after = input?.after ?? undefined;
			const sort = input?.sort ?? 'account';
			const order = input?.order ?? 'asc';
			const asOfLedger = input?.asOfLedger ?? undefined;
			const parsedAsset = parseAsset(asset);
			if (requireIssued && parsedAsset.type === 'native')
				throw new HubbleWarehouseInputError(
					'Asset trustlines require an issued asset'
				);
			if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
				throw new HubbleWarehouseInputError(
					'limit must be an integer between 1 and 200'
				);
			if (after !== undefined && after === '')
				throw new HubbleWarehouseInputError(
					'after must be one non-empty value'
				);
			if (sort !== 'account' && sort !== 'balance')
				throw new HubbleWarehouseInputError('sort must be account or balance');
			if (order !== 'asc' && order !== 'desc')
				throw new HubbleWarehouseInputError('order must be asc or desc');
			if (
				asOfLedger !== undefined &&
				(!Number.isSafeInteger(asOfLedger) ||
					asOfLedger < 1 ||
					asOfLedger > 4294967295)
			)
				throw new HubbleWarehouseInputError(
					'asOfLedger must be a valid ledger'
				);
			const page = await warehouse.assetHolders({
				asset: parsedAsset,
				limit,
				after,
				sort,
				order,
				asOfLedger,
				balanceFilter:
					forceAll || input?.includeZero === true ? 'all' : 'positive',
				includeDeleted: input?.includeDeleted ?? false
			});
			return { ...page, holders: page.holders.map(holder) };
		} catch (error) {
			throw mapError(error);
		}
	};
	return {
		hubbleAssetHolders: (args: ListArguments) => list(args, false, false),
		hubbleAssetBalances: (args: ListArguments) => list(args, true, false),
		hubbleAssetTrustlines: (args: ListArguments) => list(args, true, true),
		hubbleAssetHolder: async ({ asset, account }: DetailArguments) => {
			try {
				const page = await warehouse.assetHolders({
					asset: parseAsset(asset),
					account: requireStellarAddress(account, 'account'),
					limit: 1
				});
				return {
					asset: page.asset,
					holder: page.holders[0] ? holder(page.holders[0]) : null,
					coverage: page.coverage,
					watermark: page.watermark
				};
			} catch (error) {
				throw mapError(error);
			}
		}
	};
}
