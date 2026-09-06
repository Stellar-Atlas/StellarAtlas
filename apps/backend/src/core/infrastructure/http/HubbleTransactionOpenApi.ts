import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

const text: OpenApiRecord = { type: 'string' };
const nullableText: OpenApiRecord = { type: 'string', nullable: true };
const integer: OpenApiRecord = { type: 'integer', minimum: 0 };
const boolean: OpenApiRecord = { type: 'boolean' };
const exactInteger: OpenApiRecord = { type: 'string', pattern: '^-?[0-9]+$' };
function object(properties: OpenApiRecord): OpenApiRecord {
	return {
		type: 'object',
		additionalProperties: false,
		properties,
		required: Object.keys(properties)
	};
}
function page(items: OpenApiRecord): OpenApiRecord {
	return object({
		items: { type: 'array', items },
		limit: { type: 'integer', minimum: 1, maximum: 200 },
		nextCursor: nullableText
	});
}
const amount = object({
	field: text,
	decimal: {
		type: 'string',
		description:
			'Exact decimal text; scale describes this serialization, not arbitrary contract token metadata.'
	},
	raw: exactInteger,
	scale: integer,
	source: { type: 'string', enum: ['envelope', 'effect'] }
});
const transaction = object({
	id: exactInteger,
	hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
	ledgerSequence: integer,
	closedAt: { type: 'string', format: 'date-time' },
	sourceAccount: text,
	sourceAccountMuxed: nullableText,
	sequence: exactInteger,
	successful: boolean,
	operationCount: integer,
	memoType: text,
	memo: text,
	feeChargedRaw: exactInteger,
	maxFeeRaw: exactInteger,
	feeAccount: nullableText,
	resultCode: text
});
const operation = object({
	id: exactInteger,
	transactionId: exactInteger,
	index: integer,
	ledgerSequence: integer,
	closedAt: { type: 'string', format: 'date-time' },
	type: text,
	typeCode: integer,
	sourceAccount: text,
	sourceAccountMuxed: nullableText,
	resultCode: text,
	traceCode: text,
	envelopeDecoded: {
		type: 'boolean',
		description:
			'True only when the stored envelope hash and operation count match this transaction.'
	},
	amounts: { type: 'array', items: amount },
	detailsJson: {
		type: 'string',
		description:
			'Supplemental legacy ETL details; numeric amounts here may be rounded. Use amounts for exact envelope values.'
	}
});
const effect = object({
	id: text,
	operationId: exactInteger,
	index: integer,
	ledgerSequence: integer,
	closedAt: { type: 'string', format: 'date-time' },
	type: text,
	typeCode: integer,
	account: text,
	accountMuxed: nullableText,
	amounts: { type: 'array', items: amount },
	detailsJson: text
});
const classification = object({
	transactionKind: { type: 'string', enum: ['classic', 'soroban', 'unknown'] },
	eventKind: {
		type: 'string',
		enum: ['fee', 'operation', 'contract', 'diagnostic', 'unknown']
	},
	sorobanExecutionEvidence: boolean,
	provenance: {
		type: 'string',
		enum: ['complete', 'missing', 'incomplete', 'mismatch']
	}
});
const event = object({
	id: text,
	transactionId: exactInteger,
	transactionHash: text,
	operationId: nullableText,
	ledgerSequence: integer,
	closedAt: { type: 'string', format: 'date-time' },
	contractId: text,
	type: text,
	typeCode: integer,
	successful: boolean,
	inSuccessfulContractCall: boolean,
	topicsJson: text,
	dataJson: text,
	eventXdr: text,
	classification
});
export const hubbleTypedTransactionSchema = object({
	transaction,
	operations: page(operation),
	effects: page(effect),
	events: page(event),
	observedAt: { type: 'string', format: 'date-time' },
	coverage: { type: 'string', enum: ['ingested-only'] }
});
export const hubbleTransactionParameters: readonly OpenApiRecord[] = [
	{
		in: 'query',
		name: 'view',
		required: false,
		schema: { type: 'string', enum: ['typed'] },
		description:
			'Omit for the unchanged legacy object with array relationships. typed opts into the parsed, cursor-paginated representation.'
	},
	{
		in: 'query',
		name: 'ledger_sequence',
		required: false,
		schema: { type: 'integer', minimum: 1, maximum: 2147483647 },
		description:
			'Optional known ledger hint for typed view; constrains native primary key and partition. Hash-only lookup remains supported but can be slower.'
	},
	{
		in: 'query',
		name: 'limit',
		required: false,
		schema: { type: 'integer', minimum: 1, maximum: 200, default: 25 },
		description:
			'Maximum items per typed relationship page. Larger limits are rejected, not silently truncated.'
	},
	...['operations_after', 'effects_after', 'events_after'].map((name) => ({
		in: 'query',
		name,
		required: false,
		schema: { type: 'string', maxLength: 2048 },
		description:
			"Use only this relation's nextCursor with the same transaction. Independent ascending execution-order keyset; not a frozen snapshot under backfill/retries."
	}))
];
export const hubbleTransactionDescription =
	'Locate a transaction by hash. The default response retains transaction, ledger, operations, contractEvents and tokenTransfers. ' +
	'Use view=typed for parsed transaction plus independently cursor-paginated operations, effects and classified events. ' +
	'A ledger_sequence hint is optional; relationships always bind to the resolved exact ledger and transaction ID. ' +
	'Only completed matching batch/digest facts are visible; absent rows do not imply complete archive coverage. ' +
	'All IDs, fees and exact amounts are strings. Operation amounts come from a hash-verified envelope; effect amounts come from exact ETL decimal strings. ' +
	'Supplemental detailsJson can contain rounded legacy numbers, and arbitrary event decoded JSON is not an exact numeric contract: eventXdr retains source evidence. ' +
	'Cursors preserve full ascending operation/effect/event ordering with metadata tie breakers, not an immutable backfill snapshot. ' +
	'Execution budgets belong to the existing read-only ClickHouse profile; hash-only lookup currently uses its bloom index and can time out. ' +
	'Example: ?view=typed&ledger_sequence=26000000&limit=5. GraphQL parity: hubbleTransaction(transactionHash: "5601a324dae6b95aeb626e4de68268fbb996a655979228178d291fc4b8c908cd", ledgerSequence: 26000000, limit: 5) { transaction { id hash ledgerSequence feeChargedRaw } operations { items { id type amounts { field raw scale } } nextCursor } effects { items { id operationId type } nextCursor } events { items { id classification { transactionKind eventKind provenance } } nextCursor } }.';
export const hubbleTransactionResponse: OpenApiRecord = {
	description:
		'Legacy transaction detail, or typed cursor-paginated transaction detail when view=typed.',
	content: {
		'application/json': {
			schema: {
				oneOf: [
					{
						type: 'object',
						additionalProperties: true,
						required: ['transaction', 'operations'],
						properties: {
							transaction: { type: 'object', additionalProperties: true },
							operations: {
								type: 'array',
								items: { type: 'object', additionalProperties: true }
							}
						}
					},
					hubbleTypedTransactionSchema
				]
			}
		}
	}
};
