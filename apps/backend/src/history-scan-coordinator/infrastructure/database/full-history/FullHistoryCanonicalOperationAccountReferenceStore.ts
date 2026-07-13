import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import type { FullHistoryOperationAccountReferenceInput } from '../../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
import { FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE } from '../../../domain/full-history/FullHistoryCanonicalOperationAccountReference.js';
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

const accountReferenceChunkSize = 500;

interface AccountReferenceRow {
	readonly accountId: string;
	readonly baseAccountId: string;
	readonly factScope: string;
	readonly operationIndex: number;
	readonly role: string;
	readonly transactionHash: Buffer;
}

interface AccountReferenceCoverageRow {
	readonly accountReferenceCount: number;
	readonly factScope: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastLedger: FullHistoryLedgerSequence;
	readonly operationCount: number;
	readonly referenceDecoderVersion: string;
}

export async function storeCanonicalOperationAccountReferences(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	referenceDecoderVersion = input.operationAccountReferenceDecoderVersion
): Promise<void> {
	assertBoundedText(
		referenceDecoderVersion,
		'operationAccountReferenceDecoderVersion',
		128
	);
	for (const references of chunkFullHistoryValues(
		input.operationAccountReferences,
		accountReferenceChunkSize
	)) {
		await insertAccountReferences(manager, networkHash, references);
	}
	await insertAccountReferenceCoverage(
		manager,
		input,
		networkHash,
		referenceDecoderVersion
	);
}

export async function assertCanonicalOperationAccountReferences(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	referenceDecoderVersion = input.operationAccountReferenceDecoderVersion
): Promise<void> {
	assertBoundedText(
		referenceDecoderVersion,
		'operationAccountReferenceDecoderVersion',
		128
	);
	const rows = await readAccountReferences(manager, input.batchId);
	const coverageRows = await readAccountReferenceCoverage(
		manager,
		input.batchId
	);
	if (
		!accountReferencesMatch(rows, input.operationAccountReferences) ||
		!accountReferenceCoverageMatches(
			coverageRows,
			input,
			referenceDecoderVersion
		)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Canonical operation account references differ from the immutable checkpoint batch'
		);
	}
}

async function insertAccountReferences(
	manager: EntityManager,
	networkHash: FullHistoryHash,
	references: readonly FullHistoryOperationAccountReferenceInput[]
): Promise<void> {
	if (references.length === 0) return;
	const insert = buildFullHistorySqlValues(
		references.map((reference) => [
			networkHash.toBuffer(),
			reference.transactionHash.toBuffer(),
			reference.operationIndex,
			reference.role,
			reference.accountId,
			reference.baseAccountId,
			reference.factScope
		])
	);
	await manager.query(
		`
			insert into "full_history_operation_account_reference" (
				"network_passphrase_hash", "transaction_hash", "operation_index",
				"role", "account_id", "base_account_id", "fact_scope"
			) values ${insert.placeholders}
			on conflict do nothing
		`,
		insert.parameters
	);
}

async function insertAccountReferenceCoverage(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	referenceDecoderVersion: string
): Promise<void> {
	await manager.query(
		`
			insert into "full_history_operation_account_reference_batch_coverage" (
				"batch_id", "network_passphrase_hash", "first_ledger",
				"last_ledger", "operation_count", "account_reference_count",
				"fact_scope", "reference_decoder_version"
			) values ($1, $2, $3, $4, $5, $6, $7, $8)
			on conflict do nothing
		`,
		[
			input.batchId,
			networkHash.toBuffer(),
			input.firstLedger,
			input.lastLedger,
			input.operations.length,
			input.operationAccountReferences.length,
			FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE,
			referenceDecoderVersion
		]
	);
}

async function readAccountReferences(
	manager: EntityManager,
	batchId: string
): Promise<AccountReferenceRow[]> {
	return manager.query(
		`
			select reference."transaction_hash" as "transactionHash",
				reference."operation_index" as "operationIndex",
				reference."role", reference."account_id" as "accountId",
				reference."base_account_id" as "baseAccountId",
				reference."fact_scope" as "factScope"
			from "full_history_operation_account_reference" reference
			join "full_history_operation" operation
				on operation."network_passphrase_hash" =
					reference."network_passphrase_hash"
				and operation."transaction_hash" = reference."transaction_hash"
				and operation."operation_index" = reference."operation_index"
			where operation."batch_id" = $1
			order by reference."transaction_hash", reference."operation_index",
				reference."role", reference."account_id"
		`,
		[batchId]
	);
}

async function readAccountReferenceCoverage(
	manager: EntityManager,
	batchId: string
): Promise<AccountReferenceCoverageRow[]> {
	return manager.query(
		`
			select "first_ledger"::text as "firstLedger",
				"last_ledger"::text as "lastLedger",
				"operation_count" as "operationCount",
				"account_reference_count" as "accountReferenceCount",
				"reference_decoder_version" as "referenceDecoderVersion",
				"fact_scope" as "factScope"
			from "full_history_operation_account_reference_batch_coverage"
			where "batch_id" = $1
		`,
		[batchId]
	);
}

function accountReferencesMatch(
	rows: readonly AccountReferenceRow[],
	expected: readonly FullHistoryOperationAccountReferenceInput[]
): boolean {
	const byIdentity = new Map(
		expected.map((reference) => [referenceIdentity(reference), reference])
	);
	return (
		rows.length === expected.length &&
		rows.every((row) => {
			const reference = byIdentity.get(
				`${row.transactionHash.toString('hex')}:${row.operationIndex}:${row.role}:${row.accountId}`
			);
			return (
				reference !== undefined &&
				row.baseAccountId === reference.baseAccountId &&
				row.factScope === reference.factScope
			);
		})
	);
}

function accountReferenceCoverageMatches(
	rows: readonly AccountReferenceCoverageRow[],
	input: FullHistoryCheckpointWrite,
	referenceDecoderVersion: string
): boolean {
	const row = rows[0];
	return (
		rows.length === 1 &&
		row !== undefined &&
		row.firstLedger === input.firstLedger &&
		row.lastLedger === input.lastLedger &&
		row.operationCount === input.operations.length &&
		row.accountReferenceCount === input.operationAccountReferences.length &&
		row.referenceDecoderVersion === referenceDecoderVersion &&
		row.factScope === FULL_HISTORY_OPERATION_ACCOUNT_REFERENCE_FACT_SCOPE
	);
}

function referenceIdentity(
	reference: FullHistoryOperationAccountReferenceInput
): string {
	return `${reference.transactionHash.toHex()}:${reference.operationIndex}:${reference.role}:${reference.accountId}`;
}
