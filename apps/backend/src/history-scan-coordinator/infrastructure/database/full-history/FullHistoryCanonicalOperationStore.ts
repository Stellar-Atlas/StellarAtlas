import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationInput } from '../../../domain/full-history/FullHistoryCanonicalOperation.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	assertBoundedText,
	FullHistoryHash,
	type FullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	buildFullHistorySqlValues,
	chunkFullHistoryValues
} from './FullHistorySqlValues.js';

const operationChunkSize = 500;

interface OperationRow {
	readonly factScope: string;
	readonly ledgerSequence: FullHistoryLedgerSequence;
	readonly operationIndex: number;
	readonly operationType: string;
	readonly sourceAccount: string;
	readonly sourceAccountOrigin: string;
	readonly transactionHash: Buffer;
	readonly transactionIndex: number;
}

interface OperationCoverageRow {
	readonly factScope: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly operationDecoderVersion: string;
	readonly transactionCount: number;
}

export async function storeCanonicalOperations(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	operationDecoderVersion = input.operationDecoderVersion
): Promise<void> {
	assertBoundedText(operationDecoderVersion, 'operationDecoderVersion', 128);
	for (const operations of chunkFullHistoryValues(
		input.operations,
		operationChunkSize
	)) {
		await insertOperations(manager, input.batchId, networkHash, operations);
	}
	await insertOperationCoverage(
		manager,
		input,
		networkHash,
		operationDecoderVersion
	);
}

export async function assertCanonicalOperations(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	operationDecoderVersion = input.operationDecoderVersion
): Promise<void> {
	assertBoundedText(operationDecoderVersion, 'operationDecoderVersion', 128);
	const rows = await readOperations(manager, input.batchId);
	const coverageRows = await readOperationCoverage(manager, input.batchId);
	if (
		!operationsMatch(rows, input.operations) ||
		!operationCoverageMatches(coverageRows, input, operationDecoderVersion)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical operation rows differ from the immutable checkpoint batch'
		);
	}
}

async function insertOperationCoverage(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	operationDecoderVersion: string
): Promise<void> {
	await manager.query(
		`
			insert into "full_history_operation_batch_coverage" (
				"batch_id", "network_passphrase_hash", "first_ledger",
				"last_ledger", "transaction_count", "operation_count",
				"fact_scope", "operation_decoder_version"
			) values ($1, $2, $3, $4, $5, $6, $7, $8)
			on conflict do nothing
		`,
		[
			input.batchId,
			networkHash.toBuffer(),
			input.firstLedger,
			input.lastLedger,
			input.transactions.length,
			input.operations.length,
			'operation_body_and_envelope',
			operationDecoderVersion
		]
	);
}

async function insertOperations(
	manager: EntityManager,
	batchId: string,
	networkHash: FullHistoryHash,
	operations: readonly FullHistoryOperationInput[]
): Promise<void> {
	if (operations.length === 0) return;
	const insert = buildFullHistorySqlValues(
		operations.map((operation) => [
			networkHash.toBuffer(),
			operation.transactionHash.toBuffer(),
			operation.operationIndex,
			batchId,
			operation.ledgerSequence,
			operation.transactionIndex,
			operation.operationType,
			operation.sourceAccount,
			operation.sourceAccountOrigin,
			operation.factScope
		])
	);
	await manager.query(
		`
			insert into "full_history_operation" (
				"network_passphrase_hash", "transaction_hash", "operation_index",
				"batch_id", "ledger_sequence", "transaction_index",
				"operation_type", "source_account", "source_account_origin",
				"fact_scope"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function readOperations(
	manager: EntityManager,
	batchId: string
): Promise<OperationRow[]> {
	return manager.query(
		`
			select "transaction_hash" as "transactionHash",
				"operation_index" as "operationIndex",
				"ledger_sequence"::text as "ledgerSequence",
				"transaction_index" as "transactionIndex",
				"operation_type" as "operationType",
				"source_account" as "sourceAccount",
				"source_account_origin" as "sourceAccountOrigin",
				"fact_scope" as "factScope"
			from "full_history_operation"
			where "batch_id" = $1
			order by "ledger_sequence", "transaction_index", "operation_index"
		`,
		[batchId]
	);
}

async function readOperationCoverage(
	manager: EntityManager,
	batchId: string
): Promise<OperationCoverageRow[]> {
	return manager.query(
		`
			select "first_ledger"::text as "firstLedger",
				"last_ledger"::text as "lastLedger",
				"transaction_count" as "transactionCount",
				"operation_count" as "operationCount",
				"operation_decoder_version" as "operationDecoderVersion",
				"fact_scope" as "factScope"
			from "full_history_operation_batch_coverage"
			where "batch_id" = $1
		`,
		[batchId]
	);
}

function operationsMatch(
	rows: readonly OperationRow[],
	expected: readonly FullHistoryOperationInput[]
): boolean {
	const byIdentity = new Map(
		expected.map((operation) => [operationIdentity(operation), operation])
	);
	return (
		rows.length === expected.length &&
		rows.every((row) => {
			const operation = byIdentity.get(
				`${row.transactionHash.toString('hex')}:${row.operationIndex}`
			);
			return (
				operation !== undefined &&
				row.ledgerSequence === operation.ledgerSequence &&
				row.transactionIndex === operation.transactionIndex &&
				row.operationType === operation.operationType &&
				row.sourceAccount === operation.sourceAccount &&
				row.sourceAccountOrigin === operation.sourceAccountOrigin &&
				row.factScope === operation.factScope
			);
		})
	);
}

function operationCoverageMatches(
	rows: readonly OperationCoverageRow[],
	input: FullHistoryCheckpointWrite,
	operationDecoderVersion: string
): boolean {
	const row = rows[0];
	return (
		rows.length === 1 &&
		row !== undefined &&
		row.firstLedger === input.firstLedger &&
		row.lastLedger === input.lastLedger &&
		row.transactionCount === input.transactions.length &&
		row.operationCount === input.operations.length &&
		row.operationDecoderVersion === operationDecoderVersion &&
		row.factScope === 'operation_body_and_envelope'
	);
}

function operationIdentity(operation: FullHistoryOperationInput): string {
	return `${operation.transactionHash.toHex()}:${operation.operationIndex}`;
}
