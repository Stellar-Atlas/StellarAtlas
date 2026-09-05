import type { HubbleTransferInput } from './HubbleTransferContracts.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { scopedTransferInput } from './HubbleTransferRoutes.js';

export const hubbleTransferSchema = `
	extend type Query {
		hubbleTransfers(input: HubbleTransferInput): HubbleTransferPage!
		hubbleAccountTransfers(account: String!, input: HubbleTransferInput): HubbleTransferPage!
		hubbleAssetTransfers(asset: String!, input: HubbleTransferInput): HubbleTransferPage!
	}
	input HubbleTransferInput {
		account: String
		from: String
		to: String
		asset: String
		contractId: String
		transactionHash: String
		eventTopic: String
		startTime: String
		endTime: String
		minLedger: Int
		maxLedger: Int
		amountRaw: String
		minAmountRaw: String
		maxAmountRaw: String
		limit: Int
		after: String
	}
	type HubbleTransferPage {
		transfers: [HubbleTransfer!]!
		limit: Int!
		nextCursor: String
		watermark: HubbleTransferWatermark!
		elapsedMilliseconds: Float!
	}
	type HubbleTransferWatermark {
		minimumLedger: Int!
		maximumLedger: Int!
		observedAt: String!
		coverage: String!
	}
	type HubbleTransferAsset {
		id: String!
		type: String!
		code: String
		issuer: String
	}
	type HubbleTransfer {
		id: String!
		ledgerSequence: Int!
		closedAt: String!
		transactionHash: String!
		transactionId: String!
		operationId: String
		from: String
		to: String
		toMuxed: String
		asset: HubbleTransferAsset!
		contractId: String!
		eventTopic: String!
		amountRaw: String!
		amountScale: Int
	}
`;

interface Arguments {
	readonly input?: HubbleTransferInput | null;
	readonly account?: string;
	readonly asset?: string;
}
export function hubbleTransferResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
): Record<
	string,
	(args: Arguments) => ReturnType<HubbleWarehouse['transferActivity']>
> {
	const execute = async (args: Arguments) => {
		try {
			const scope: { account?: string; asset?: string } = {};
			if (args.account !== undefined) scope.account = args.account;
			if (args.asset !== undefined) scope.asset = args.asset;
			return await warehouse.transferActivity(
				scopedTransferInput(args.input ?? {}, scope)
			);
		} catch (error) {
			throw mapError(error);
		}
	};
	return {
		hubbleTransfers: execute,
		hubbleAccountTransfers: execute,
		hubbleAssetTransfers: execute
	};
}
