import type { GraphQLError } from 'graphql';
import type { HubbleTransactionInput } from './HubbleTransactionContracts.js';
import { normalizeTransactionInput } from './HubbleTransactionCursor.js';
import type { HubbleWarehouse } from './HubbleWarehouseContracts.js';

export const hubbleTransactionSchema = `
 extend type Query {
  hubbleTransaction(transactionHash: String!, ledgerSequence: Int, limit: Int, operationsAfter: String, effectsAfter: String, eventsAfter: String): HubbleTransactionDetail
 }
 type HubbleTransactionDetail {
  transaction: HubbleTransactionRecord!
  operations: HubbleTransactionOperationPage!
  effects: HubbleTransactionEffectPage!
  events: HubbleTransactionEventPage!
  observedAt: String!
  coverage: String!
 }
 type HubbleTransactionRecord {
  id: String!
  hash: String!
  ledgerSequence: Int!
  closedAt: String!
  sourceAccount: String!
  sourceAccountMuxed: String
  sequence: String!
  successful: Boolean!
  operationCount: Int!
  memoType: String!
  memo: String!
  feeChargedRaw: String!
  maxFeeRaw: String!
  feeAccount: String
  resultCode: String!
 }
 type HubbleExactAmount {
  field: String!
  decimal: String!
  raw: String!
  scale: Int!
  source: String!
 }
 type HubbleTransactionOperation {
  id: String!
  transactionId: String!
  index: Int!
  ledgerSequence: Int!
  closedAt: String!
  type: String!
  typeCode: Int!
  sourceAccount: String!
  sourceAccountMuxed: String
  resultCode: String!
  traceCode: String!
  envelopeDecoded: Boolean!
  amounts: [HubbleExactAmount!]!
  detailsJson: String!
 }
 type HubbleTransactionEffect {
  id: String!
  operationId: String!
  index: Int!
  ledgerSequence: Int!
  closedAt: String!
  type: String!
  typeCode: Int!
  account: String!
  accountMuxed: String
  amounts: [HubbleExactAmount!]!
  detailsJson: String!
 }
 type HubbleEventClassification {
  transactionKind: String!
  eventKind: String!
  sorobanExecutionEvidence: Boolean!
  provenance: String!
 }
 type HubbleTransactionEvent {
  id: String!
  transactionId: String!
  transactionHash: String!
  operationId: String
  ledgerSequence: Int!
  closedAt: String!
  contractId: String!
  type: String!
  typeCode: Int!
  successful: Boolean!
  inSuccessfulContractCall: Boolean!
  topicsJson: String!
  dataJson: String!
  eventXdr: String!
  classification: HubbleEventClassification!
 }
 type HubbleTransactionOperationPage {
  items: [HubbleTransactionOperation!]!
  limit: Int!
  nextCursor: String
 }
 type HubbleTransactionEffectPage {
  items: [HubbleTransactionEffect!]!
  limit: Int!
  nextCursor: String
 }
 type HubbleTransactionEventPage {
  items: [HubbleTransactionEvent!]!
  limit: Int!
  nextCursor: String
 }
`;
export function hubbleTransactionResolvers(
	warehouse: HubbleWarehouse,
	mapError: (error: unknown) => GraphQLError
) {
	return {
		hubbleTransaction: async (input: HubbleTransactionInput) => {
			try {
				return await warehouse.transactionDetail(
					normalizeTransactionInput(input)
				);
			} catch (error) {
				throw mapError(error);
			}
		}
	};
}
