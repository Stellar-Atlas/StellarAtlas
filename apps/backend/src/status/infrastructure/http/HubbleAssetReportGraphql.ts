import { StrKey } from '@stellar/stellar-sdk';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import { parseAsset } from './HubbleSemanticRouteHelpers.js';
import {
	queryAssetBalanceHistory,
	queryAssetRankings,
	type RankingSelection,
	type ReportSelection
} from './HubbleAssetReportQuery.js';

export const hubbleAssetReportSchema = `
	extend type Query {
			hubbleAssetRankings(asset: String!, input: HubbleAssetReportInput): HubbleAssetReportPage!
			hubbleAssetBalanceHistory(asset: String!, input: HubbleAssetReportInput): HubbleAssetReportPage!
	}
	input HubbleAssetReportInput {
		metric: String
		counterAsset: String
		account: String
		minLedger: String
		maxLedger: String
		startTime: String
		endTime: String
		limit: Int
		after: String
		order: String
	}
	type HubbleAssetReportPage {
		asset: String!
		data: [JSON!]!
		limit: Int!
		nextCursor: String
		generatedAt: String!
		coverage: HubbleLedgerCoverage!
		coverageStatus: String!
		amountPrecision: String!
		marketTypes: [String!]
		semantics: String
	}
`;

interface AssetReportArguments {
	readonly asset: string;
	readonly input?: {
		readonly metric?: string | null;
		readonly counterAsset?: string | null;
		readonly account?: string | null;
		readonly minLedger?: string | null;
		readonly maxLedger?: string | null;
		readonly startTime?: string | null;
		readonly endTime?: string | null;
		readonly limit?: number | null;
		readonly after?: string | null;
		readonly order?: string | null;
	} | null;
}
function positiveBound(
	value: string | null | undefined,
	name: string
): number | undefined {
	if (value == null) return undefined;
	if (!/^[0-9]{1,10}$/.test(value))
		throw new HubbleWarehouseInputError(name + ' must be a positive ledger');
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 4294967295)
		throw new HubbleWarehouseInputError(name + ' must be a positive ledger');
	return parsed;
}
function reportSelection(
	asset: string,
	input: AssetReportArguments['input']
): ReportSelection & { account?: string } {
	const minLedger = positiveBound(input?.minLedger, 'minLedger'),
		maxLedger = positiveBound(input?.maxLedger, 'maxLedger');
	if (
		minLedger !== undefined &&
		maxLedger !== undefined &&
		minLedger > maxLedger
	)
		throw new HubbleWarehouseInputError('minLedger cannot exceed maxLedger');
	const startTime = input?.startTime ?? undefined,
		endTime = input?.endTime ?? undefined;
	for (const value of [startTime, endTime])
		if (
			value !== undefined &&
			(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
				!Number.isFinite(Date.parse(value)))
		)
			throw new HubbleWarehouseInputError('Times must be UTC ISO timestamps');
	if (startTime && endTime && Date.parse(startTime) > Date.parse(endTime))
		throw new HubbleWarehouseInputError('startTime cannot exceed endTime');
	const limit = input?.limit ?? 100,
		order = input?.order ?? 'desc',
		after = input?.after ?? undefined,
		account = input?.account ?? undefined;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200)
		throw new HubbleWarehouseInputError('limit must be between 1 and 200');
	if (order !== 'asc' && order !== 'desc')
		throw new HubbleWarehouseInputError('order must be asc or desc');
	if (after !== undefined && (!after || after.length > 2048))
		throw new HubbleWarehouseInputError('Invalid report cursor');
	if (
		account !== undefined &&
		!StrKey.isValidEd25519PublicKey(account) &&
		!StrKey.isValidContract(account)
	)
		throw new HubbleWarehouseInputError(
			'account must be a checksum-valid G or C address'
		);
	return {
		asset: parseAsset(asset),
		...(minLedger === undefined ? {} : { minLedger }),
		...(maxLedger === undefined ? {} : { maxLedger }),
		...(startTime ? { startTime } : {}),
		...(endTime ? { endTime } : {}),
		limit,
		...(after ? { after } : {}),
		order,
		...(account ? { account } : {})
	};
}
export function hubbleAssetReportResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
) {
	const executor = () => {
		if (!warehouse.readModelExecutor)
			throw new HubbleWarehouseUnavailableError(
				'Hubble report read model is unavailable'
			);
		return warehouse.readModelExecutor();
	};
	return {
		hubbleAssetRankings: async ({ asset, input }: AssetReportArguments) => {
			try {
				const base = reportSelection(asset, input),
					metric = input?.metric ?? 'volume';
				if (!['bought', 'sold', 'volume', 'transactions'].includes(metric))
					throw new HubbleWarehouseInputError(
						'metric must be bought, sold, volume, or transactions'
					);
				const counter = input?.counterAsset ?? undefined;
				const selection: RankingSelection = {
					...base,
					metric: metric as RankingSelection['metric'],
					...(counter ? { counterAsset: parseAsset(counter) } : {})
				};
				return await queryAssetRankings(await executor(), selection);
			} catch (error) {
				throw mapError(error);
			}
		},
		hubbleAssetBalanceHistory: async ({
			asset,
			input
		}: AssetReportArguments) => {
			try {
				const selection = reportSelection(asset, input);
				return await queryAssetBalanceHistory(
					await executor(),
					selection,
					selection.account
				);
			} catch (error) {
				throw mapError(error);
			}
		}
	};
}
