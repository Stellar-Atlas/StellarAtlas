import type {
	HubbleContractEventInput,
	HubbleContractEventPage
} from './HubbleContractEventContracts.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';
import { normalizeHubbleContractEventInput } from './HubbleContractEventValidation.js';

export const hubbleContractEventSchema = `
	extend type Query {
		hubbleContractEvents(contractId: String!, input: HubbleContractEventInput): HubbleContractEventPage!
	}
	input HubbleContractEventInput {
		transactionHash: String
		minLedger: Int
		maxLedger: Int
		startTime: String
		endTime: String
		typeCode: Int
		successful: Boolean
		inSuccessfulContractCall: Boolean
		order: String
		topic: String
		search: String
		includeSummary: Boolean
		limit: Int
		after: String
	}
	type HubbleContractEventPage {
		contractId: String!
		items: [HubbleTransactionEvent!]!
		limit: Int!
		nextCursor: String
		watermark: HubbleTransferWatermark!
		coverage: HubbleLedgerCoverage!
		elapsedMilliseconds: Float!
		summary: HubbleContractEventSummary
	}
	type HubbleContractEventSummary {
		total: String!
		topics: [HubbleContractEventTopicCount!]!
	}
	type HubbleContractEventTopicCount { topic: String!, count: String! }
`;
type Arguments = {
	contractId: string;
	input?: Omit<HubbleContractEventInput, 'contractId'> | null;
};
export function hubbleContractEventResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => Error
): Record<string, (args: Arguments) => Promise<HubbleContractEventPage>> {
	return {
		hubbleContractEvents: async (args: Arguments) => {
			try {
				return await warehouse.contractEvents(
					normalizeHubbleContractEventInput({
						...args.input,
						contractId: args.contractId
					})
				);
			} catch (error) {
				throw mapError(error);
			}
		}
	};
}
