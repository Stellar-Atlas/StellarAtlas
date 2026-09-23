import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { queryExplorer } from './HubbleExplorerQuery.js';
import type { ExplorerEntity } from './HubbleExplorerMapper.js';

const windowFields =
	'minLedger: Int maxLedger: Int startTime: String endTime: String';
export const hubbleExplorerSchema = `
	extend type Query {
		hubbleOperations(input: HubbleOperationInput): HubbleOperationPage!
		hubbleOperation(id: String!, input: HubbleExplorerWindowInput): HubbleOperationDetail!
		hubbleAssets(input: HubbleAssetInput): HubbleAssetPage!
		hubbleAsset(id: String!, input: HubbleExplorerWindowInput): HubbleAssetDetail!
		hubbleContracts(input: HubbleExplorerPageInput): HubbleContractPage!
		hubbleContract(id: String!, input: HubbleExplorerWindowInput): HubbleContractDetail!
		hubbleTrades(input: HubbleTradeInput): HubbleTradePage!
		hubbleTrade(id: String!, input: HubbleExplorerWindowInput): HubbleTradeDetail!
		hubbleOffers(input: HubbleOfferInput): HubbleOfferPage!
		hubbleOffer(id: String!, input: HubbleExplorerWindowInput): HubbleOfferDetail!
	}
	input HubbleExplorerWindowInput { ${windowFields} }
	input HubbleExplorerPageInput { ${windowFields} limit: Int offset: Int }
	input HubbleOperationInput { ${windowFields} limit: Int offset: Int sourceAccount: String type: String }
	input HubbleAssetInput { ${windowFields} limit: Int offset: Int assetCode: String assetIssuer: String }
	input HubbleTradeInput {
		${windowFields}
		limit: Int offset: Int seller: String buyer: String sellingAsset: String buyingAsset: String operationId: String
	}
	input HubbleOfferInput {
		${windowFields}
		limit: Int offset: Int seller: String sellingAsset: String buyingAsset: String offerId: String
	}
	type HubbleExplorerWindow { minLedger: Int! maxLedger: Int! }
	type HubbleSourceRecord { batchId: String! digest: String! rowNumber: String! }
	type HubblePriceRatio { numerator: String! denominator: String! }
	"""Parsed operation and its bounded transaction relationship; identifiers remain exact strings."""
	type HubbleExplorerOperation {
		id: String! transactionId: String! transactionHash: String sourceAccount: String!
		type: String! typeCode: Int! details: JSON
		ledgerSequence: Int! closedAt: String! sourceRecord: HubbleSourceRecord!
	}
	"""Contract identity observed in the selected parsed window, not proof of current deployed state."""
	type HubbleExplorerContract { id: String! }
	type HubbleOperationPage { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! limit: Int! offset: Int! nextOffset: Int rows: [HubbleExplorerOperation!]! }
	type HubbleOperationDetail { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! record: HubbleExplorerOperation }
	type HubbleAssetPage { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! limit: Int! offset: Int! nextOffset: Int rows: [HubbleTransferAsset!]! }
	type HubbleAssetDetail { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! record: HubbleTransferAsset }
	type HubbleContractPage { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! limit: Int! offset: Int! nextOffset: Int rows: [HubbleExplorerContract!]! }
	type HubbleContractDetail { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! record: HubbleExplorerContract }
	type HubbleTrade {
		id: String! ledgerSequence: Int! operationId: String! order: Int!
		seller: String buyer: String sellingAsset: HubbleTransferAsset! buyingAsset: HubbleTransferAsset!
		sellingAmount: String! buyingAmount: String! amountPrecision: String!
		price: HubblePriceRatio! closedAt: String! sourceRecord: HubbleSourceRecord!
	}
	type HubbleOffer {
		id: String! seller: String! ledgerSequence: Int!
		sellingAsset: HubbleTransferAsset! buyingAsset: HubbleTransferAsset!
		amount: String! amountPrecision: String! price: HubblePriceRatio!
		deleted: Boolean! lastModifiedLedger: Int! closedAt: String! sourceRecord: HubbleSourceRecord!
	}
	type HubbleTradePage { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! limit: Int! offset: Int! nextOffset: Int rows: [HubbleTrade!]! }
	type HubbleOfferPage { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! limit: Int! offset: Int! nextOffset: Int rows: [HubbleOffer!]! }
	type HubbleTradeDetail { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! record: HubbleTrade }
	type HubbleOfferDetail { entity: String! window: HubbleExplorerWindow! coverage: HubbleLedgerCoverage! coverageStatus: String! source: String! semantics: String! record: HubbleOffer }
`;
interface Input {
	readonly minLedger?: number;
	readonly maxLedger?: number;
	readonly startTime?: string;
	readonly endTime?: string;
	readonly limit?: number;
	readonly offset?: number;
	readonly seller?: string;
	readonly buyer?: string;
	readonly sellingAsset?: string;
	readonly buyingAsset?: string;
	readonly operationId?: string;
	readonly offerId?: string;
	readonly sourceAccount?: string;
	readonly type?: string;
	readonly assetCode?: string;
	readonly assetIssuer?: string;
}
interface Arguments {
	readonly id?: string;
	readonly input?: Input | null;
}
export function hubbleExplorerResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
): Record<string, (args: Arguments) => Promise<Record<string, unknown>>> {
	const execute =
		(entity: ExplorerEntity) =>
		async ({ id, input }: Arguments) => {
			try {
				const {
					seller,
					buyer,
					sellingAsset,
					buyingAsset,
					operationId,
					offerId,
					sourceAccount,
					type,
					assetCode,
					assetIssuer,
					...window
				} = input ?? {};
				const filters: Record<string, string> = {};
				for (const [name, value] of Object.entries({
					seller,
					buyer,
					selling_asset: sellingAsset,
					buying_asset: buyingAsset,
					operation_id: operationId,
					offer_id: offerId,
					source_account: sourceAccount,
					type,
					asset_code: assetCode,
					asset_issuer: assetIssuer
				}))
					if (value != null) filters[name] = value;
				return await queryExplorer(warehouse, {
					...window,
					entity,
					id,
					filters
				});
			} catch (error) {
				throw mapError(error);
			}
		};
	return {
		hubbleOperations: execute('operations'),
		hubbleOperation: execute('operations'),
		hubbleAssets: execute('assets'),
		hubbleAsset: execute('assets'),
		hubbleContracts: execute('contracts'),
		hubbleContract: execute('contracts'),
		hubbleTrades: execute('trades'),
		hubbleTrade: execute('trades'),
		hubbleOffers: execute('offers'),
		hubbleOffer: execute('offers')
	};
}
