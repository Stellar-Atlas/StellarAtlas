import type { DataSource } from 'typeorm';
import {
	FULL_HISTORY_OPERATION_FACT_SCOPE,
	FULL_HISTORY_OPERATION_QUERY_LIMIT_MAX,
	isFullHistoryOperationSourceAccount,
	isFullHistoryOperationType,
	type FullHistoryOperationCoverage,
	type FullHistoryOperationOutcomeAvailable,
	type FullHistoryOperationOutcomeUnavailable,
	type FullHistoryOperationPage,
	type FullHistoryOperationQuery,
	type FullHistoryOperationSourceOrigin,
	type FullHistoryOperationView
} from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
import {
	FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
	isFullHistoryOperationResultCode,
	type FullHistoryOperationOutcome
} from '../../../domain/full-history/FullHistoryCanonicalOperationResult.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface FullHistoryOperationRow {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly checkpointLedger: string;
	readonly checkpointProofId: number;
	readonly closedAt: Date | string;
	readonly decoderVersion: string;
	readonly factScope: string;
	readonly ledgerSequence: string;
	readonly operationIndex: number;
	readonly operationResultCode: number | null;
	readonly operationSpecificResultCode: number | null;
	readonly operationType: string;
	readonly outcome: string | null;
	readonly outcomeDecoderVersion: string | null;
	readonly outcomeFactScope: string | null;
	readonly proofEvaluatedAt: Date | string;
	readonly proofVersion: number;
	readonly sourceAccount: string;
	readonly sourceAccountOrigin: string;
	readonly transactionHash: Uint8Array;
	readonly transactionIndex: number;
}

interface FullHistoryOperationCoverageRow {
	readonly canonicalBatches: string;
	readonly firstIndexedLedger: string | null;
	readonly indexedBatches: string;
	readonly lastIndexedLedger: string | null;
	readonly firstOutcomeIndexedLedger: string | null;
	readonly lastOutcomeIndexedLedger: string | null;
	readonly outcomeIndexedBatches: string;
}

export async function findCanonicalOperations(
	dataSource: DataSource,
	networkHash: FullHistoryHash,
	query: FullHistoryOperationQuery
): Promise<FullHistoryOperationPage> {
	validateQuery(query);
	const coverage = await getCanonicalOperationCoverage(dataSource, networkHash);
	const rows = await dataSource.query<FullHistoryOperationRow[]>(
		`
			select
				batch."archive_url_identity" as "archiveUrlIdentity",
				operation."batch_id" as "batchId",
				batch."checkpoint_ledger"::text as "checkpointLedger",
				batch."checkpoint_proof_id" as "checkpointProofId",
				ledger."closed_at" as "closedAt",
				coverage."operation_decoder_version" as "decoderVersion",
				operation."fact_scope" as "factScope",
				operation."ledger_sequence"::text as "ledgerSequence",
				operation."operation_index" as "operationIndex",
				result."operation_result_code" as "operationResultCode",
				result."operation_specific_result_code" as
					"operationSpecificResultCode",
				operation."operation_type" as "operationType",
				result."outcome" as "outcome",
				result_coverage."result_decoder_version" as
					"outcomeDecoderVersion",
				result."fact_scope" as "outcomeFactScope",
				batch."proof_evaluated_at" as "proofEvaluatedAt",
				batch."proof_version" as "proofVersion",
				operation."source_account" as "sourceAccount",
				operation."source_account_origin" as "sourceAccountOrigin",
				operation."transaction_hash" as "transactionHash",
				operation."transaction_index" as "transactionIndex"
			from "full_history_operation" operation
			join "full_history_ingestion_batch" batch
				on batch.id = operation."batch_id"
				and batch."network_passphrase_hash" =
					operation."network_passphrase_hash"
			join "full_history_ledger" ledger
				on ledger."network_passphrase_hash" =
					operation."network_passphrase_hash"
				and ledger."ledger_sequence" = operation."ledger_sequence"
			join "full_history_operation_batch_coverage" coverage
				on coverage."batch_id" = operation."batch_id"
				and coverage."network_passphrase_hash" =
					operation."network_passphrase_hash"
			left join "full_history_operation_result" result
				on result."network_passphrase_hash" =
					operation."network_passphrase_hash"
				and result."transaction_hash" = operation."transaction_hash"
				and result."operation_index" = operation."operation_index"
			left join "full_history_operation_result_batch_coverage" result_coverage
				on result_coverage."batch_id" = operation."batch_id"
				and result_coverage."network_passphrase_hash" =
					operation."network_passphrase_hash"
			where operation."network_passphrase_hash" = $1
				and ($2::text is null or operation."operation_type" = $2)
				and ($3::bigint is null or operation."ledger_sequence" >= $3)
				and ($4::bigint is null or operation."ledger_sequence" <= $4)
					and ($5::bytea is null or operation."transaction_hash" = $5)
					and ($6::text is null or operation."source_account" = $6)
					and ($7::timestamptz is null or ledger."closed_at" >= $7)
					and ($8::timestamptz is null or ledger."closed_at" <= $8)
			order by operation."ledger_sequence" desc,
				operation."transaction_index" desc,
				operation."operation_index"
				limit $9
		`,
		[
			networkHash.toBuffer(),
			query.operationType ?? null,
			query.firstLedger ?? null,
			query.lastLedger ?? null,
			query.transactionHash?.toBuffer() ?? null,
			query.sourceAccount ?? null,
			query.closedAtFrom ?? null,
			query.closedAtTo ?? null,
			query.limit + 1
		]
	);
	return {
		coverage,
		records: rows.slice(0, query.limit).map(mapOperationRow),
		truncated: rows.length > query.limit
	};
}

export async function getCanonicalOperationCoverage(
	dataSource: DataSource,
	networkHash: FullHistoryHash
): Promise<FullHistoryOperationCoverage> {
	const rows = await dataSource.query<FullHistoryOperationCoverageRow[]>(
		`
			select count(batch.id)::text as "canonicalBatches",
				count(coverage."batch_id")::text as "indexedBatches",
				count(result_coverage."batch_id")::text as "outcomeIndexedBatches",
				min(coverage."first_ledger")::text as "firstIndexedLedger",
				max(coverage."last_ledger")::text as "lastIndexedLedger",
				min(result_coverage."first_ledger")::text as
					"firstOutcomeIndexedLedger",
				max(result_coverage."last_ledger")::text as
					"lastOutcomeIndexedLedger"
			from "full_history_ingestion_batch" batch
			left join "full_history_operation_batch_coverage" coverage
				on coverage."batch_id" = batch.id
				and coverage."network_passphrase_hash" =
					batch."network_passphrase_hash"
			left join "full_history_operation_result_batch_coverage" result_coverage
				on result_coverage."batch_id" = batch.id
				and result_coverage."network_passphrase_hash" =
					batch."network_passphrase_hash"
			where batch."network_passphrase_hash" = $1
		`,
		[networkHash.toBuffer()]
	);
	const row = rows[0];
	if (row === undefined) {
		throw new Error('PostgreSQL did not return operation coverage');
	}
	const canonicalBatches = readCount(row.canonicalBatches, 'canonicalBatches');
	const indexedBatches = readCount(row.indexedBatches, 'indexedBatches');
	const outcomeIndexedBatches = readCount(
		row.outcomeIndexedBatches,
		'outcomeIndexedBatches'
	);
	return {
		canonicalBatches,
		complete: canonicalBatches > 0 && indexedBatches === canonicalBatches,
		firstIndexedLedger: readOptionalLedger(
			row.firstIndexedLedger,
			'firstIndexedLedger'
		),
		firstOutcomeIndexedLedger: readOptionalLedger(
			row.firstOutcomeIndexedLedger,
			'firstOutcomeIndexedLedger'
		),
		indexedBatches,
		lastIndexedLedger: readOptionalLedger(
			row.lastIndexedLedger,
			'lastIndexedLedger'
		),
		lastOutcomeIndexedLedger: readOptionalLedger(
			row.lastOutcomeIndexedLedger,
			'lastOutcomeIndexedLedger'
		),
		outcomeIndexedBatches,
		outcomesComplete:
			canonicalBatches > 0 && outcomeIndexedBatches === canonicalBatches
	};
}

function validateQuery(query: FullHistoryOperationQuery): void {
	if (
		!Number.isSafeInteger(query.limit) ||
		query.limit < 1 ||
		query.limit > FULL_HISTORY_OPERATION_QUERY_LIMIT_MAX
	) {
		throw new RangeError(
			`limit must be an integer between 1 and ${FULL_HISTORY_OPERATION_QUERY_LIMIT_MAX}`
		);
	}
	if (
		query.operationType !== undefined &&
		!isFullHistoryOperationType(query.operationType)
	) {
		throw new Error('operationType is unsupported');
	}
	if (
		query.sourceAccount !== undefined &&
		!isFullHistoryOperationSourceAccount(query.sourceAccount)
	) {
		throw new Error('sourceAccount must be a valid Stellar StrKey');
	}
	if (
		query.transactionHash !== undefined &&
		!(query.transactionHash instanceof FullHistoryHash)
	) {
		throw new TypeError('transactionHash must be a FullHistoryHash');
	}
	const first =
		query.firstLedger === undefined
			? undefined
			: fullHistoryLedgerSequence(query.firstLedger, 'firstLedger');
	const last =
		query.lastLedger === undefined
			? undefined
			: fullHistoryLedgerSequence(query.lastLedger, 'lastLedger');
	if (
		first !== undefined &&
		last !== undefined &&
		BigInt(first) > BigInt(last)
	) {
		throw new RangeError('firstLedger must not exceed lastLedger');
	}
	const closedAtFrom = validateOptionalDate(query.closedAtFrom, 'closedAtFrom');
	const closedAtTo = validateOptionalDate(query.closedAtTo, 'closedAtTo');
	if (
		closedAtFrom !== undefined &&
		closedAtTo !== undefined &&
		closedAtFrom.getTime() > closedAtTo.getTime()
	) {
		throw new RangeError('closedAtFrom must not exceed closedAtTo');
	}
}

function validateOptionalDate(
	value: Date | undefined,
	name: string
): Date | undefined {
	if (value === undefined) return undefined;
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
		throw new TypeError(`${name} must be a valid Date`);
	}
	return value;
}

function mapOperationRow(
	row: FullHistoryOperationRow
): FullHistoryOperationView {
	if (!isFullHistoryOperationType(row.operationType)) {
		throw new Error('PostgreSQL returned an unsupported operation type');
	}
	if (row.factScope !== FULL_HISTORY_OPERATION_FACT_SCOPE) {
		throw new Error('PostgreSQL returned an unsupported operation fact scope');
	}
	const sourceAccountOrigin = readSourceOrigin(row.sourceAccountOrigin);
	return {
		archiveUrlIdentity: row.archiveUrlIdentity,
		batchId: row.batchId,
		checkpointLedger: fullHistoryLedgerSequence(
			row.checkpointLedger,
			'checkpointLedger'
		),
		checkpointProofId: row.checkpointProofId,
		closedAt: readDate(row.closedAt),
		decoderVersion: row.decoderVersion,
		factScope: FULL_HISTORY_OPERATION_FACT_SCOPE,
		ledgerSequence: fullHistoryLedgerSequence(
			row.ledgerSequence,
			'ledgerSequence'
		),
		operationIndex: row.operationIndex,
		operationType: row.operationType,
		...mapOperationOutcome(row),
		proofEvaluatedAt: readDate(row.proofEvaluatedAt),
		proofVersion: row.proofVersion,
		sourceAccount: row.sourceAccount,
		sourceAccountOrigin,
		transactionHash: FullHistoryHash.fromBytes(row.transactionHash),
		transactionIndex: row.transactionIndex
	};
}

function mapOperationOutcome(
	row: FullHistoryOperationRow
):
	| FullHistoryOperationOutcomeAvailable
	| FullHistoryOperationOutcomeUnavailable {
	if (row.outcome === null) {
		if (
			row.outcomeDecoderVersion !== null ||
			row.outcomeFactScope !== null ||
			row.operationResultCode !== null ||
			row.operationSpecificResultCode !== null
		) {
			throw new Error('PostgreSQL returned incomplete operation outcome facts');
		}
		return {
			outcome: null,
			outcomeAvailable: false,
			outcomeDecoderVersion: null,
			outcomeFactScope: null,
			operationResultCode: null,
			operationSpecificResultCode: null
		};
	}

	const outcome = readOutcome(row.outcome);
	if (
		row.outcomeDecoderVersion === null ||
		row.outcomeFactScope !== FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE ||
		(row.operationResultCode !== null &&
			!isFullHistoryOperationResultCode(row.operationResultCode)) ||
		!outcomeMatchesCodes(
			outcome,
			row.operationResultCode,
			row.operationSpecificResultCode
		)
	) {
		throw new Error('PostgreSQL returned invalid operation outcome facts');
	}
	return {
		outcome,
		outcomeAvailable: true,
		outcomeDecoderVersion: row.outcomeDecoderVersion,
		outcomeFactScope: FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
		operationResultCode: row.operationResultCode,
		operationSpecificResultCode: row.operationSpecificResultCode
	};
}

function readOutcome(value: string): FullHistoryOperationOutcome {
	if (value === 'failed' || value === 'not_applied' || value === 'succeeded') {
		return value;
	}
	throw new Error('PostgreSQL returned an unsupported operation outcome');
}

function outcomeMatchesCodes(
	outcome: FullHistoryOperationOutcome,
	resultCode: number | null,
	specificResultCode: number | null
): boolean {
	if (outcome === 'not_applied') {
		return resultCode === null && specificResultCode === null;
	}
	if (outcome === 'succeeded') {
		return resultCode === 0 && specificResultCode === 0;
	}
	return (
		(resultCode !== null && resultCode < 0 && specificResultCode === null) ||
		(resultCode === 0 &&
			specificResultCode !== null &&
			specificResultCode !== 0)
	);
}

function readSourceOrigin(value: string): FullHistoryOperationSourceOrigin {
	if (value === 'operation' || value === 'transaction') return value;
	throw new Error('PostgreSQL returned an unsupported operation source origin');
}

function readDate(value: Date | string): Date {
	const date =
		value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new TypeError('PostgreSQL returned an invalid operation timestamp');
	}
	return date;
}

function readCount(value: string, field: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TypeError(`PostgreSQL returned an invalid ${field}`);
	}
	return count;
}

function readOptionalLedger(
	value: string | null,
	field: string
): ReturnType<typeof fullHistoryLedgerSequence> | null {
	return value === null ? null : fullHistoryLedgerSequence(value, field);
}
