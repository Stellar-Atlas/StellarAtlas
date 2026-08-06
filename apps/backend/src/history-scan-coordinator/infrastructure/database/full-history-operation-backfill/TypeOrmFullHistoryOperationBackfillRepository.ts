import type { DataSource, EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { validateFullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	validateFullHistoryOperationBackfillLimit,
	type FullHistoryOperationBackfillBatch
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import type {
	FullHistoryOperationBackfillReceipt,
	FullHistoryOperationBackfillRepository
} from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfillRepository.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	assertBoundedText,
	assertInteger,
	assertUuid,
	assertValidDate,
	fullHistoryLedgerSequence,
	FullHistoryHash,
	hashNetworkPassphrase
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	assertBatchMatches,
	findBatch
} from '../full-history/FullHistoryCanonicalBatchStore.js';
import { storeCanonicalOperations } from '../full-history/FullHistoryCanonicalOperationStore.js';
import {
	fullHistoryOperationAccountReferenceChunkSize,
	storeCanonicalOperationAccountReferenceChunk,
	storeCanonicalOperationAccountReferenceCoverage
} from '../full-history/FullHistoryCanonicalOperationAccountReferenceStore.js';
import { storeCanonicalOperationResults } from '../full-history/FullHistoryCanonicalOperationResultStore.js';
import { assertOperationBackfillBaseFacts } from './FullHistoryOperationBackfillBaseFactValidator.js';
import {
	advanceOperationAccountReferenceProgress,
	deleteOperationAccountReferenceProgress,
	lockOperationAccountReferenceProgress
} from './FullHistoryOperationProjectionProgressStore.js';

interface BackfillBatchRow {
	readonly archiveUrlIdentity: string;
	readonly batchId: string;
	readonly canonicalDecoderVersion: string;
	readonly checkpointLedger: string;
	readonly checkpointStateContentDigest: Uint8Array;
	readonly checkpointStateObjectRemoteId: string;
	readonly firstLedger: string;
	readonly lastLedger: string;
	readonly ledgerContentDigest: Uint8Array;
	readonly ledgerObjectRemoteId: string;
	readonly proofEvaluatedAt: Date | string;
	readonly proofId: number;
	readonly proofVersion: number;
	readonly resultsContentDigest: Uint8Array;
	readonly resultsObjectRemoteId: string;
	readonly transactionsContentDigest: Uint8Array;
	readonly transactionsObjectRemoteId: string;
}

interface BatchIdentityRow {
	readonly batchId: string;
}

interface CoverageStateRow {
	readonly accountReferenceDecoderVersion: string | null;
	readonly operationDecoderVersion: string | null;
	readonly resultDecoderVersion: string | null;
}

export interface FullHistoryOperationBackfillTransactionBounds {
	readonly lockTimeoutMs: number;
	readonly statementTimeoutMs: number;
}

const defaultTransactionBounds: FullHistoryOperationBackfillTransactionBounds =
	{
		lockTimeoutMs: 2_000,
		statementTimeoutMs: 5 * 60_000
	};

export class TypeOrmFullHistoryOperationBackfillRepository implements FullHistoryOperationBackfillRepository {
	private readonly transactionBounds: FullHistoryOperationBackfillTransactionBounds;

	constructor(
		private readonly dataSource: DataSource,
		transactionBounds: FullHistoryOperationBackfillTransactionBounds = defaultTransactionBounds
	) {
		this.transactionBounds = {
			lockTimeoutMs: assertInteger(
				transactionBounds.lockTimeoutMs,
				'lockTimeoutMs',
				1,
				60_000
			),
			statementTimeoutMs: assertInteger(
				transactionBounds.statementTimeoutMs,
				'statementTimeoutMs',
				1,
				30 * 60_000
			)
		};
	}

	async findUnindexedBatches(
		networkPassphrase: string,
		limit: number
	): Promise<readonly FullHistoryOperationBackfillBatch[]> {
		validateFullHistoryOperationBackfillLimit(limit);
		const networkHash = hashNetworkPassphrase(networkPassphrase);
		const rows = await this.dataSource.query<BackfillBatchRow[]>(
			`
				select batch.id as "batchId",
					batch."archive_url_identity" as "archiveUrlIdentity",
					batch."decoder_version" as "canonicalDecoderVersion",
					batch."checkpoint_ledger"::text as "checkpointLedger",
					batch."first_ledger"::text as "firstLedger",
					batch."last_ledger"::text as "lastLedger",
					batch."checkpoint_proof_id" as "proofId",
					batch."proof_version" as "proofVersion",
					batch."proof_evaluated_at" as "proofEvaluatedAt",
					batch."checkpoint_state_object_remote_id"
						as "checkpointStateObjectRemoteId",
					batch."checkpoint_state_content_digest"
						as "checkpointStateContentDigest",
					batch."ledger_object_remote_id" as "ledgerObjectRemoteId",
					batch."ledger_content_digest" as "ledgerContentDigest",
					batch."transactions_object_remote_id"
						as "transactionsObjectRemoteId",
					batch."transactions_content_digest"
						as "transactionsContentDigest",
					batch."results_object_remote_id" as "resultsObjectRemoteId",
					batch."results_content_digest" as "resultsContentDigest"
				from "full_history_ingestion_batch" batch
				left join "full_history_operation_batch_coverage" coverage
					on coverage."batch_id" = batch.id
				left join "full_history_operation_result_batch_coverage" result_coverage
					on result_coverage."batch_id" = batch.id
				left join
					"full_history_operation_account_reference_batch_coverage"
						reference_coverage
					on reference_coverage."batch_id" = batch.id
				where batch."network_passphrase_hash" = $1
					and (
						coverage."batch_id" is null
						or result_coverage."batch_id" is null
						or reference_coverage."batch_id" is null
					)
				order by batch."last_ledger" desc, batch.id
				limit $2
			`,
			[networkHash.toBuffer(), limit]
		);
		return rows.map(mapBatch);
	}

	async storeOperations(
		input: FullHistoryCheckpointWrite
	): Promise<FullHistoryOperationBackfillReceipt> {
		validateFullHistoryCheckpointWrite(input);
		const networkHash = hashNetworkPassphrase(input.networkPassphrase);
		const coverage = await this.readValidatedCoverage(input, networkHash);
		const replayed =
			coverage.operationDecoderVersion !== null &&
			coverage.accountReferenceDecoderVersion !== null &&
			coverage.resultDecoderVersion !== null;

		if (coverage.operationDecoderVersion === null) {
			await this.storeOperationProjection(input, networkHash);
		}
		if (coverage.accountReferenceDecoderVersion === null) {
			await this.storeAccountReferenceProjection(input, networkHash);
		}
		if (coverage.resultDecoderVersion === null) {
			await this.storeResultProjection(input, networkHash);
		}

		return {
			accountReferenceCount: input.operationAccountReferences.length,
			batchId: input.batchId,
			operationCount: input.operations.length,
			replayed
		};
	}

	private async readValidatedCoverage(
		input: FullHistoryCheckpointWrite,
		networkHash: FullHistoryHash
	): Promise<CoverageStateRow> {
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, this.transactionBounds);
			await assertStoredBatch(manager, input, networkHash);
			await assertOperationBackfillBaseFacts(manager, input, networkHash);
			return readCoverageState(manager, input.batchId);
		});
	}

	private async storeOperationProjection(
		input: FullHistoryCheckpointWrite,
		networkHash: FullHistoryHash
	): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, this.transactionBounds);
			await assertStoredBatch(manager, input, networkHash);
			const coverage = await readCoverageState(manager, input.batchId);
			if (coverage.operationDecoderVersion === null) {
				await storeCanonicalOperations(
					manager,
					input,
					networkHash,
					input.operationDecoderVersion
				);
			}
		});
	}

	private async storeAccountReferenceProjection(
		input: FullHistoryCheckpointWrite,
		networkHash: FullHistoryHash
	): Promise<void> {
		while (!(await this.storeNextAccountReferenceChunk(input, networkHash))) {
			// Each iteration commits one durable chunk and its resume cursor.
		}
	}

	private async storeNextAccountReferenceChunk(
		input: FullHistoryCheckpointWrite,
		networkHash: FullHistoryHash
	): Promise<boolean> {
		return this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, this.transactionBounds);
			await assertStoredBatch(manager, input, networkHash);
			const coverage = await readCoverageState(manager, input.batchId);
			if (coverage.accountReferenceDecoderVersion !== null) {
				await deleteOperationAccountReferenceProgress(
					manager,
					input.batchId
				);
				return true;
			}

			const progress = await lockOperationAccountReferenceProgress(
				manager,
				input
			);
			if (progress.nextOffset === progress.expectedCount) {
				await storeCanonicalOperationAccountReferenceCoverage(
					manager,
					input,
					networkHash,
					input.operationAccountReferenceDecoderVersion
				);
				await deleteOperationAccountReferenceProgress(
					manager,
					input.batchId
				);
				return true;
			}

			const nextOffset = Math.min(
				progress.nextOffset +
					fullHistoryOperationAccountReferenceChunkSize,
				progress.expectedCount
			);
			await storeCanonicalOperationAccountReferenceChunk(
				manager,
				networkHash,
				input.operationAccountReferences.slice(
					progress.nextOffset,
					nextOffset
				)
			);
			await advanceOperationAccountReferenceProgress(
				manager,
				input.batchId,
				progress.nextOffset,
				nextOffset
			);
			return false;
		});
	}

	private async storeResultProjection(
		input: FullHistoryCheckpointWrite,
		networkHash: FullHistoryHash
	): Promise<void> {
		await this.dataSource.transaction(async (manager) => {
			await setTransactionBounds(manager, this.transactionBounds);
			await assertStoredBatch(manager, input, networkHash);
			const coverage = await readCoverageState(manager, input.batchId);
			if (coverage.resultDecoderVersion === null) {
				await storeCanonicalOperationResults(
					manager,
					input,
					networkHash,
					input.operationResultDecoderVersion
				);
			}
		});
	}
}

async function assertStoredBatch(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	await lockBatch(manager, input.batchId, networkHash);
	const stored = await findBatch(manager, input.batchId);
	if (stored === null) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Operation backfill batch no longer exists'
		);
	}
	assertBatchMatches(stored, input, networkHash);
}

function mapBatch(row: BackfillBatchRow): FullHistoryOperationBackfillBatch {
	return {
		archiveUrlIdentity: assertBoundedText(
			row.archiveUrlIdentity,
			'archiveUrlIdentity',
			2_048
		),
		batchId: assertUuid(row.batchId, 'batchId'),
		canonicalDecoderVersion: assertBoundedText(
			row.canonicalDecoderVersion,
			'canonicalDecoderVersion',
			128
		),
		checkpointLedger: fullHistoryLedgerSequence(
			row.checkpointLedger,
			'checkpointLedger'
		),
		firstLedger: fullHistoryLedgerSequence(row.firstLedger, 'firstLedger'),
		lastLedger: fullHistoryLedgerSequence(row.lastLedger, 'lastLedger'),
		proofEvaluatedAt: assertValidDate(
			new Date(row.proofEvaluatedAt),
			'proofEvaluatedAt'
		),
		proofId: assertInteger(row.proofId, 'proofId', 1),
		proofVersion: assertInteger(row.proofVersion, 'proofVersion', 1, 32_767),
		sources: {
			checkpointState: {
				contentDigest: FullHistoryHash.fromBytes(
					row.checkpointStateContentDigest
				),
				remoteId: assertUuid(
					row.checkpointStateObjectRemoteId,
					'checkpointStateObjectRemoteId'
				)
			},
			ledger: {
				contentDigest: FullHistoryHash.fromBytes(row.ledgerContentDigest),
				remoteId: assertUuid(row.ledgerObjectRemoteId, 'ledgerObjectRemoteId')
			},
			results: {
				contentDigest: FullHistoryHash.fromBytes(row.resultsContentDigest),
				remoteId: assertUuid(row.resultsObjectRemoteId, 'resultsObjectRemoteId')
			},
			transactions: {
				contentDigest: FullHistoryHash.fromBytes(row.transactionsContentDigest),
				remoteId: assertUuid(
					row.transactionsObjectRemoteId,
					'transactionsObjectRemoteId'
				)
			}
		}
	};
}

async function lockBatch(
	manager: EntityManager,
	batchId: string,
	networkHash: FullHistoryHash
): Promise<void> {
	const rows = await manager.query<BatchIdentityRow[]>(
		`
			select id as "batchId" from "full_history_ingestion_batch"
			where id = $1 and "network_passphrase_hash" = $2
			for update
		`,
		[batchId, networkHash.toBuffer()]
	);
	if (rows.length !== 1) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Operation backfill batch is missing or belongs to another network'
		);
	}
}

async function readCoverageState(
	manager: EntityManager,
	batchId: string
): Promise<CoverageStateRow> {
	const rows = await manager.query<CoverageStateRow[]>(
		`select
			(select "reference_decoder_version"
			 from "full_history_operation_account_reference_batch_coverage"
			 where "batch_id" = $1) as "accountReferenceDecoderVersion",
			(select "operation_decoder_version"
			 from "full_history_operation_batch_coverage"
			 where "batch_id" = $1) as "operationDecoderVersion",
			(select "result_decoder_version"
			 from "full_history_operation_result_batch_coverage"
			 where "batch_id" = $1) as "resultDecoderVersion"`,
		[batchId]
	);
	return (
		rows[0] ?? {
			accountReferenceDecoderVersion: null,
			operationDecoderVersion: null,
			resultDecoderVersion: null
		}
	);
}

async function setTransactionBounds(
	manager: EntityManager,
	bounds: FullHistoryOperationBackfillTransactionBounds
): Promise<void> {
	await manager.query(
		`select set_config('lock_timeout', $1, true),
			set_config('statement_timeout', $2, true)`,
		[`${bounds.lockTimeoutMs}ms`, `${bounds.statementTimeoutMs}ms`]
	);
}
