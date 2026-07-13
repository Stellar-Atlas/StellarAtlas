import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationResultInput } from '../../../domain/full-history/FullHistoryCanonicalOperationResult.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	assertBoundedText,
	FullHistoryHash,
	hashNetworkPassphrase,
	type FullHistoryLedgerSequence
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	buildFullHistorySqlValues,
	chunkFullHistoryValues
} from './FullHistorySqlValues.js';

const operationResultChunkSize = 500;

interface OperationResultRow {
	readonly factScope: string;
	readonly operationIndex: number;
	readonly operationResultCode: number | null;
	readonly operationSpecificResultCode: number | null;
	readonly outcome: string;
	readonly transactionHash: Buffer;
}

interface OperationResultCoverageRow {
	readonly factScope: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly resultDecoderVersion: string;
}

export async function storeCanonicalOperationResults(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	resultDecoderVersion = input.operationResultDecoderVersion
): Promise<void> {
	assertBoundedText(resultDecoderVersion, 'resultDecoderVersion', 128);
	for (const results of chunkFullHistoryValues(
		input.operationResults,
		operationResultChunkSize
	)) {
		await insertOperationResults(manager, networkHash, results);
	}
	await insertOperationResultCoverage(
		manager,
		input,
		networkHash,
		resultDecoderVersion
	);
}

export async function assertCanonicalOperationResults(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	resultDecoderVersion = input.operationResultDecoderVersion
): Promise<void> {
	assertBoundedText(resultDecoderVersion, 'resultDecoderVersion', 128);
	const resultsMatch = await storedOperationResultsMatch(
		manager,
		hashNetworkPassphrase(input.networkPassphrase),
		input.operationResults
	);
	const coverage = await readOperationResultCoverage(manager, input.batchId);
	if (
		!resultsMatch ||
		!operationResultCoverageMatches(coverage, input, resultDecoderVersion)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical operation-result rows differ from the immutable checkpoint batch'
		);
	}
}

async function insertOperationResults(
	manager: EntityManager,
	networkHash: FullHistoryHash,
	results: readonly FullHistoryOperationResultInput[]
): Promise<void> {
	if (results.length === 0) return;
	const insert = buildFullHistorySqlValues(
		results.map((result) => [
			networkHash.toBuffer(),
			result.transactionHash.toBuffer(),
			result.operationIndex,
			result.outcome,
			result.operationResultCode,
			result.operationSpecificResultCode,
			result.factScope
		])
	);
	await manager.query(
		`
			insert into "full_history_operation_result" (
				"network_passphrase_hash", "transaction_hash", "operation_index",
				"outcome", "operation_result_code",
				"operation_specific_result_code", "fact_scope"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function insertOperationResultCoverage(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	resultDecoderVersion: string
): Promise<void> {
	await manager.query(
		`
			insert into "full_history_operation_result_batch_coverage" (
				"batch_id", "network_passphrase_hash", "first_ledger",
				"last_ledger", "operation_count", "fact_scope",
				"result_decoder_version"
			) values ($1, $2, $3, $4, $5, $6, $7)
			on conflict do nothing
		`,
		[
			input.batchId,
			networkHash.toBuffer(),
			input.firstLedger,
			input.lastLedger,
			input.operationResults.length,
			'transaction_result_xdr',
			resultDecoderVersion
		]
	);
}

async function storedOperationResultsMatch(
	manager: EntityManager,
	networkHash: FullHistoryHash,
	expected: readonly FullHistoryOperationResultInput[]
): Promise<boolean> {
	for (const chunk of chunkFullHistoryValues(
		expected,
		operationResultChunkSize
	)) {
		const rows = await readOperationResultChunk(manager, networkHash, chunk);
		if (!operationResultsMatch(rows, chunk)) return false;
	}
	return true;
}

async function readOperationResultChunk(
	manager: EntityManager,
	networkHash: FullHistoryHash,
	expected: readonly FullHistoryOperationResultInput[]
): Promise<OperationResultRow[]> {
	const identities = buildFullHistorySqlValues(
		expected.map((result) => [
			networkHash.toBuffer(),
			result.transactionHash.toBuffer(),
			result.operationIndex
		])
	);
	return manager.query(
		`
			select result."transaction_hash" as "transactionHash",
				result."operation_index" as "operationIndex", result."outcome",
				result."operation_result_code" as "operationResultCode",
				result."operation_specific_result_code"
					as "operationSpecificResultCode",
				result."fact_scope" as "factScope"
			from "full_history_operation_result" result
			where (
				result."network_passphrase_hash", result."transaction_hash",
				result."operation_index"
			) in (${identities.placeholders})
		`,
		identities.parameters
	);
}

async function readOperationResultCoverage(
	manager: EntityManager,
	batchId: string
): Promise<OperationResultCoverageRow[]> {
	return manager.query(
		`
			select "first_ledger"::text as "firstLedger",
				"last_ledger"::text as "lastLedger",
				"operation_count" as "operationCount",
				"fact_scope" as "factScope",
				"result_decoder_version" as "resultDecoderVersion"
			from "full_history_operation_result_batch_coverage"
			where "batch_id" = $1
		`,
		[batchId]
	);
}

function operationResultsMatch(
	rows: readonly OperationResultRow[],
	expected: readonly FullHistoryOperationResultInput[]
): boolean {
	const byIdentity = new Map(
		expected.map((result) => [operationResultIdentity(result), result])
	);
	return (
		rows.length === expected.length &&
		rows.every((row) => {
			const result = byIdentity.get(
				`${row.transactionHash.toString('hex')}:${row.operationIndex}`
			);
			return (
				result !== undefined &&
				row.outcome === result.outcome &&
				row.operationResultCode === result.operationResultCode &&
				row.operationSpecificResultCode ===
					result.operationSpecificResultCode &&
				row.factScope === result.factScope
			);
		})
	);
}

function operationResultCoverageMatches(
	rows: readonly OperationResultCoverageRow[],
	input: FullHistoryCheckpointWrite,
	resultDecoderVersion: string
): boolean {
	const row = rows[0];
	return (
		rows.length === 1 &&
		row !== undefined &&
		row.firstLedger === input.firstLedger &&
		row.lastLedger === input.lastLedger &&
		row.operationCount === input.operationResults.length &&
		row.factScope === 'transaction_result_xdr' &&
		row.resultDecoderVersion === resultDecoderVersion
	);
}

function operationResultIdentity(
	result: FullHistoryOperationResultInput
): string {
	return `${result.transactionHash.toHex()}:${result.operationIndex}`;
}
