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
		hubbleAssetHolder(asset: String!, account: String!): HubbleAssetHolderDetail!
	}
	input HubbleAssetHolderInput { after: String limit: Int }
	type HubbleAssetHolderWatermark {
		mode: String!
		catalogGeneratedAt: String!
		catalogMaximumLedger: String
		snapshotPinned: Boolean!
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
	}
	type HubbleAssetHolderPage {
		asset: String!
		holders: [HubbleAssetHolder!]!
		limit: Int!
		nextCursor: String
		elapsedMilliseconds: Float!
		coverage: HubbleLedgerCoverage!
		watermark: HubbleAssetHolderWatermark!
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
		flags: optionalText(row.flags)
	};
}
interface ListArguments {
	readonly asset: string;
	readonly input?: {
		readonly limit?: number | null;
		readonly after?: string | null;
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
	return {
		hubbleAssetHolders: async ({ asset, input }: ListArguments) => {
			try {
				const limit = input?.limit ?? 100,
					after = input?.after ?? undefined;
				if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
					throw new HubbleWarehouseInputError(
						'limit must be an integer between 1 and 200'
					);
				if (after !== undefined && after === '')
					throw new HubbleWarehouseInputError(
						'after must be one non-empty value'
					);
				const page = await warehouse.assetHolders({
					asset: parseAsset(asset),
					limit,
					after
				});
				return { ...page, holders: page.holders.map(holder) };
			} catch (error) {
				throw mapError(error);
			}
		},
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
