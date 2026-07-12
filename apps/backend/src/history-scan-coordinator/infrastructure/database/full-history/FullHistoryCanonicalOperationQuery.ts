import type { DataSource } from 'typeorm';
import {
	FULL_HISTORY_OPERATION_FACT_SCOPE,
	FULL_HISTORY_OPERATION_QUERY_LIMIT_MAX,
	isFullHistoryOperationSourceAccount,
	isFullHistoryOperationType,
	type FullHistoryOperationCoverage,
	type FullHistoryOperationPage,
	type FullHistoryOperationQuery,
	type FullHistoryOperationSourceOrigin,
	type FullHistoryOperationView
} from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
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
	readonly operationType: string;
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
}

export async function findCanonicalOperations(
	dataSource: DataSource,
	networkHash: FullHistoryHash,
	query: FullHistoryOperationQuery
): Promise<FullHistoryOperationPage> {
	validateQuery(query);
	const coverage = await readOperationCoverage(dataSource, networkHash);
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
				operation."operation_type" as "operationType",
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
			where operation."network_passphrase_hash" = $1
				and ($2::text is null or operation."operation_type" = $2)
				and ($3::bigint is null or operation."ledger_sequence" >= $3)
				and ($4::bigint is null or operation."ledger_sequence" <= $4)
				and ($5::bytea is null or operation."transaction_hash" = $5)
				and ($6::text is null or operation."source_account" = $6)
			order by operation."ledger_sequence" desc,
				operation."transaction_index" desc,
				operation."operation_index"
			limit $7
		`,
		[
			networkHash.toBuffer(),
			query.operationType ?? null,
			query.firstLedger ?? null,
			query.lastLedger ?? null,
			query.transactionHash?.toBuffer() ?? null,
			query.sourceAccount ?? null,
			query.limit + 1
		]
	);
	return {
		coverage,
		records: rows.slice(0, query.limit).map(mapOperationRow),
		truncated: rows.length > query.limit
	};
}

async function readOperationCoverage(
	dataSource: DataSource,
	networkHash: FullHistoryHash
): Promise<FullHistoryOperationCoverage> {
	const rows = await dataSource.query<FullHistoryOperationCoverageRow[]>(
		`
			select count(batch.id)::text as "canonicalBatches",
				count(coverage."batch_id")::text as "indexedBatches",
				min(coverage."first_ledger")::text as "firstIndexedLedger",
				max(coverage."last_ledger")::text as "lastIndexedLedger"
			from "full_history_ingestion_batch" batch
			left join "full_history_operation_batch_coverage" coverage
				on coverage."batch_id" = batch.id
				and coverage."network_passphrase_hash" =
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
	return {
		canonicalBatches,
		complete: canonicalBatches > 0 && indexedBatches === canonicalBatches,
		firstIndexedLedger: readOptionalLedger(
			row.firstIndexedLedger,
			'firstIndexedLedger'
		),
		indexedBatches,
		lastIndexedLedger: readOptionalLedger(
			row.lastIndexedLedger,
			'lastIndexedLedger'
		)
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
		outcomeAvailable: false,
		proofEvaluatedAt: readDate(row.proofEvaluatedAt),
		proofVersion: row.proofVersion,
		sourceAccount: row.sourceAccount,
		sourceAccountOrigin,
		transactionHash: FullHistoryHash.fromBytes(row.transactionHash),
		transactionIndex: row.transactionIndex
	};
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
