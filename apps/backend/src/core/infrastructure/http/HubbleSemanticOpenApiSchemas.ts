import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { hubbleExampleDescription, hubbleLedgerExample } from './HubbleOpenApiExamples.js';
import { array, exactInteger, integer, jsonResponse, nullableText, object, ref, text } from './HubbleOpenApiSchemas.js';

// Legacy semantic routes expose parsed ETL columns, not the stricter typed DTOs.
// Additional ETL fields are retained; the live dataset catalog documents every column.
const sourceInteger: OpenApiRecord = { oneOf: [exactInteger, integer], example: '272689036992143360' };
const sourceLedger: OpenApiRecord = { oneOf: [{ type: 'string', pattern: '^[1-9][0-9]*$' }, { type: 'integer', minimum: 1, maximum: 4294967295 }], example: 63490364 };
const sourceCount: OpenApiRecord = { oneOf: [{ type: 'string', pattern: '^[0-9]+$' }, { type: 'integer', minimum: 0 }], example: 2 };
const sourceNumber: OpenApiRecord = { oneOf: [text, { type: 'number' }] };
const sourceTime: OpenApiRecord = { type: 'string', description: 'ETL UTC timestamp; legacy rows can use a space separator without a timezone suffix.' };
const record = (properties: OpenApiRecord): OpenApiRecord => ({ type: 'object', additionalProperties: true, properties });
const page = (row: string, dataset?: string): OpenApiRecord => object({
	...(dataset ? { columns: array(text), dataset: { type: 'string', enum: [dataset] } } : {}),
	elapsedMilliseconds: { type: 'number', minimum: 0 },
	limit: { type: 'integer', minimum: 1, maximum: 200 },
	offset: { type: 'integer', minimum: 0 },
	nextOffset: { type: 'integer', nullable: true, description: 'Use this offset with unchanged filters; null ends the result. Offset pages can change during backfill.' },
	rows: array(ref(row))
});
const classification = object({
	transactionKind: { type: 'string', enum: ['classic', 'soroban', 'unknown'] },
	eventKind: { type: 'string', enum: ['fee', 'operation', 'contract', 'diagnostic', 'unknown'] },
	sorobanExecutionEvidence: { type: 'boolean' },
	provenance: { type: 'string', enum: ['complete', 'missing', 'incomplete', 'mismatch'] }
});
export const holderEvidence: OpenApiRecord = {
	coverage: ref('HubbleLedgerCoverage'),
	watermark: object({
		mode: { type: 'string', enum: ['latest-ingested-observations'] },
		catalogGeneratedAt: { type: 'string', format: 'date-time' },
		catalogMaximumLedger: { ...nullableText, description: 'Maximum parsed ledger known to the cached catalog, not a bound pinned to this query.' },
		snapshotPinned: { type: 'boolean', enum: [false], description: 'Balances and catalog coverage are not an atomic snapshot. Pages may change during ingestion; historical as-of queries are not supported.' }
	})
};
export const hubbleSemanticSchemas: Record<string, OpenApiRecord> = {
	HubbleLedgerRecord: { ...record({ sequence: sourceLedger, ledger_hash: { ...text, pattern: '^[0-9a-f]{64}$' }, previous_ledger_hash: { ...text, pattern: '^[0-9a-f]{64}$' }, closed_at: sourceTime, transaction_count: sourceCount, operation_count: { ...sourceCount, example: 3 } }), description: hubbleExampleDescription + ' Hashes in this example are placeholders, not a verified ledger-header pair.', example: hubbleLedgerExample },
	HubbleTransactionRecord: record({ id: sourceInteger, transaction_hash: text, ledger_sequence: sourceLedger, account: text, account_sequence: sourceInteger, successful: { type: 'boolean' }, operation_count: sourceCount, closed_at: sourceTime }),
	HubbleOperationRecord: record({ id: sourceInteger, transaction_id: sourceInteger, ledger_sequence: sourceLedger, source_account: text, type: integer, type_string: text, details: {}, closed_at: sourceTime }),
	HubbleEffectRecord: record({ id: text, operation_id: sourceInteger, ledger_sequence: sourceLedger, index: integer, address: text, type: integer, type_string: text, details: {}, closed_at: sourceTime }),
	HubbleTransferRecord: record({ transaction_hash: text, ledger_sequence: sourceLedger, from: nullableText, to: nullableText, asset: text, asset_type: text, amount_raw: exactInteger, event_topic: text, closed_at: sourceTime }),
	HubbleTradeRecord: record({ history_operation_id: sourceInteger, order: integer, selling_account_address: nullableText, buying_account_address: nullableText, selling_amount: { ...sourceNumber, description: 'Legacy Float64 amount; not an exact atomic-unit value.' }, buying_amount: sourceNumber, price_n: sourceInteger, price_d: sourceInteger, ledger_closed_at: sourceTime }),
	HubbleContractEventRecord: record({ transaction_hash: text, transaction_id: sourceInteger, ledger_sequence: sourceLedger, contract_id: text, type: integer, topics_decoded: array({}), data_decoded: {}, event_xdr: text, classification }),
	HubbleContractStateRecord: record({ contract_id: text, ledger_sequence: sourceLedger, ledger_key_hash: text, contract_durability: text, deleted: { type: 'boolean' }, key_decoded: {}, val_decoded: {}, closed_at: sourceTime }),
	HubbleHolder: record({ account_id: text, balance: sourceNumber, buying_liabilities: sourceNumber, selling_liabilities: sourceNumber, last_modified_ledger: sourceLedger, ledger_sequence: sourceLedger, asset_code: text, asset_issuer: text, trust_line_limit: sourceNumber, flags: sourceInteger }),
	HubbleLedgerDetail: object({ ledger: ref('HubbleLedgerRecord') }),
	HubbleOperationDetail: object({ operation: ref('HubbleOperationRecord'), transaction: { ...ref('HubbleTransactionRecord'), nullable: true }, effects: array(ref('HubbleEffectRecord')) }),
	HubbleLedgerTransactionPage: page('HubbleTransactionRecord', 'history_transactions'),
	HubbleEffectPage: page('HubbleEffectRecord', 'history_effects'),
	HubbleLegacyTransferPage: page('HubbleTransferRecord', 'token_transfers'),
	HubbleLegacyTradePage: page('HubbleTradeRecord', 'history_trades'),
	HubbleContractEventPage: page('HubbleContractEventRecord', 'history_contract_events'),
	HubbleContractStatePage: page('HubbleContractStateRecord', 'contract_data'),
	HubbleAccountTransaction: record({ transaction_id: exactInteger, transaction_hash: text, relationship: { type: 'string', enum: ['source', 'effect'] }, ledger_sequence: sourceLedger, account: text, successful: { type: 'boolean' }, closed_at: sourceTime }),
	HubbleAccountTransactionPage: page('HubbleAccountTransaction'),
	HubbleHolderPage: object({ ...holderEvidence, asset: text, elapsedMilliseconds: { type: 'number' }, holders: array(ref('HubbleHolder')), limit: integer, nextCursor: { ...nullableText, description: 'Last account ID on this page. Pass as after; null ends the result.' } }),
	HubbleHolderDetail: object({ ...holderEvidence, asset: text, holder: ref('HubbleHolder') }),
	HubbleHolderNotFound: object({ ...holderEvidence, asset: text, code: { type: 'string', enum: ['hubble_record_not_found'] }, error: text })
};
const responseSchemas: Readonly<Record<string, string>> = {
	getAnalyticsLedger: 'HubbleLedgerDetail',
	listAnalyticsLedgerTransactions: 'HubbleLedgerTransactionPage',
	getAnalyticsOperation: 'HubbleOperationDetail',
	listAnalyticsOperationEffects: 'HubbleEffectPage',
	listAnalyticsAccountEffects: 'HubbleEffectPage',
	searchAnalyticsTrades: 'HubbleLegacyTradePage',
	listAnalyticsContractState: 'HubbleContractStatePage',
	listAnalyticsAssetTransfers: 'HubbleLegacyTransferPage',
	listAnalyticsAccountTransactions: 'HubbleAccountTransactionPage',
	searchAnalyticsTransfers: 'HubbleLegacyTransferPage',
	listAnalyticsContractEvents: 'HubbleContractEventPage',
	listAnalyticsAssetHolders: 'HubbleHolderPage',
	getAnalyticsAssetHolder: 'HubbleHolderDetail'
};
export function semanticResponse(operationId: string): OpenApiRecord {
	const name = responseSchemas[operationId];
	if (!name) throw new Error('Missing semantic response schema: ' + operationId);
	return jsonResponse(ref(name), 'Parsed ETL response from completed batches. IDs remain lossless strings where returned by the warehouse; legacy numeric fields are not upgraded to exact values.');
}

export const holderNotFoundResponse = jsonResponse(ref('HubbleHolderNotFound'), 'No positive balance in the latest ingested state for this account/asset. Coverage gaps mean this does not establish absence on the current chain.');
