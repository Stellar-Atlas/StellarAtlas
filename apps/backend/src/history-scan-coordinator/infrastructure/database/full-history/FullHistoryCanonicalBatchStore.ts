import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../domain/full-history/FullHistoryCanonicalError.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash,
	incrementLedgerSequence,
	type FullHistoryLedgerSequence,
	type FullHistoryUint64String
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { FullHistoryIngestionBatch } from './entities/FullHistoryIngestionBatch.js';
import { FullHistoryWatermark } from './entities/FullHistoryWatermark.js';

export interface LockedFullHistoryHistoricalFrontier {
	readonly firstBatchId: string;
	readonly firstLedger: FullHistoryLedgerSequence;
	readonly lastBatchId: string;
	readonly nextLedger: FullHistoryUint64String;
}

interface HistoricalFrontierRow {
	readonly firstBatchId: string;
	readonly firstLedger: string;
	readonly lastBatchId: string;
	readonly nextLedger: string;
}

interface ExactProofTimestampRow {
	readonly exactProofEvaluatedAt: string;
}

export async function findBatch(
	manager: EntityManager,
	batchId: string
): Promise<FullHistoryIngestionBatch | null> {
	return manager
		.getRepository(FullHistoryIngestionBatch)
		.findOneBy({ id: batchId });
}

export async function assertNoCompetingBatch(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	const rows = (await manager.query(
		`
			select id
			from "full_history_ingestion_batch"
			where "checkpoint_proof_id" = $1
				or (
					"network_passphrase_hash" = $2
					and "checkpoint_ledger" = $3
				)
			limit 1
		`,
		[input.proofId, networkHash.toBuffer(), input.checkpointLedger]
	)) as Array<{ readonly id: string }>;
	if (rows.length > 0) {
		throw new FullHistoryCanonicalError(
			'immutable-provenance-conflict',
			'Checkpoint proof or network checkpoint already belongs to another batch'
		);
	}
}

export async function insertBatch(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): Promise<void> {
	const exactProofEvaluatedAt = await readExactProofEvaluatedAt(manager, input);
	await manager.query(
		`
			insert into "full_history_ingestion_batch" (
				id, "network_passphrase_hash", "checkpoint_proof_id",
				"proof_version", "proof_evaluated_at", "archive_url_identity",
				"checkpoint_ledger", "first_ledger", "last_ledger",
				"checkpoint_state_object_remote_id",
				"checkpoint_state_content_digest", "ledger_object_remote_id",
				"ledger_content_digest", "transactions_object_remote_id",
				"transactions_content_digest", "results_object_remote_id",
				"results_content_digest", "decoder_version", "ledger_count",
				"transaction_count", "result_count"
			) values (
				$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
				$12, $13, $14, $15, $16, $17, $18, $19, $20, $21
			)
		`,
		[
			input.batchId,
			networkHash.toBuffer(),
			input.proofId,
			input.proofVersion,
			exactProofEvaluatedAt,
			input.archiveUrlIdentity,
			input.checkpointLedger,
			input.firstLedger,
			input.lastLedger,
			input.sources.checkpointState.remoteId,
			input.sources.checkpointState.contentDigest.toBuffer(),
			input.sources.ledger.remoteId,
			input.sources.ledger.contentDigest.toBuffer(),
			input.sources.transactions.remoteId,
			input.sources.transactions.contentDigest.toBuffer(),
			input.sources.results.remoteId,
			input.sources.results.contentDigest.toBuffer(),
			input.decoderVersion,
			input.ledgers.length,
			input.transactions.length,
			input.results.length
		]
	);
}

async function readExactProofEvaluatedAt(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite
): Promise<string> {
	const rows = (await manager.query(
		`
			select to_char(
				proof."evaluatedAt" at time zone 'UTC',
				'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
			) as "exactProofEvaluatedAt"
			from "history_archive_checkpoint_proof" proof
			where proof.id = $1
				and date_trunc('milliseconds', proof."evaluatedAt") =
					$2::timestamptz
		`,
		[input.proofId, input.proofEvaluatedAt]
	)) as ExactProofTimestampRow[];
	const row = rows[0];
	if (rows.length !== 1 || row === undefined) {
		throw new FullHistoryCanonicalError(
			'invalid-proof-provenance',
			'Checkpoint proof timestamp does not match immutable proof evidence'
		);
	}
	return row.exactProofEvaluatedAt;
}

export function assertBatchMatches(
	stored: FullHistoryIngestionBatch,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash
): void {
	const matches =
		stored.id === input.batchId &&
		stored.networkPassphraseHash.equals(networkHash) &&
		stored.checkpointProofId === input.proofId &&
		stored.proofVersion === input.proofVersion &&
		stored.proofEvaluatedAt.getTime() === input.proofEvaluatedAt.getTime() &&
		stored.archiveUrlIdentity === input.archiveUrlIdentity &&
		stored.checkpointLedger === input.checkpointLedger &&
		stored.firstLedger === input.firstLedger &&
		stored.lastLedger === input.lastLedger &&
		stored.checkpointStateObjectRemoteId ===
			input.sources.checkpointState.remoteId &&
		stored.checkpointStateContentDigest.equals(
			input.sources.checkpointState.contentDigest
		) &&
		stored.ledgerObjectRemoteId === input.sources.ledger.remoteId &&
		stored.ledgerContentDigest.equals(input.sources.ledger.contentDigest) &&
		stored.transactionsObjectRemoteId === input.sources.transactions.remoteId &&
		stored.transactionsContentDigest.equals(
			input.sources.transactions.contentDigest
		) &&
		stored.resultsObjectRemoteId === input.sources.results.remoteId &&
		stored.resultsContentDigest.equals(input.sources.results.contentDigest) &&
		stored.decoderVersion === input.decoderVersion &&
		stored.ledgerCount === input.ledgers.length &&
		stored.transactionCount === input.transactions.length &&
		stored.resultCount === input.results.length;

	if (!matches) {
		throw new FullHistoryCanonicalError(
			'immutable-provenance-conflict',
			'Batch identity was replayed with different immutable provenance'
		);
	}
}

export async function lockWatermark(
	manager: EntityManager,
	networkHash: FullHistoryHash
): Promise<FullHistoryWatermark | null> {
	const rows = await manager
		.getRepository(FullHistoryWatermark)
		.createQueryBuilder('watermark')
		.setLock('pessimistic_write')
		.where('watermark.network_passphrase_hash = :networkHash', {
			networkHash: networkHash.toBuffer()
		})
		.getMany();
	return rows[0] ?? null;
}

export async function lockHistoricalFrontier(
	manager: EntityManager,
	networkHash: FullHistoryHash
): Promise<LockedFullHistoryHistoricalFrontier | null> {
	const rows = (await manager.query(
		`
			select "first_batch_id" as "firstBatchId",
				"first_ledger"::text as "firstLedger",
				"last_batch_id" as "lastBatchId",
				"next_ledger"::text as "nextLedger"
			from "full_history_watermark"
			where "network_passphrase_hash" = $1
			for update
		`,
		[networkHash.toBuffer()]
	)) as HistoricalFrontierRow[];
	const row = rows[0];
	return row === undefined
		? null
		: {
				firstBatchId: row.firstBatchId,
				firstLedger: fullHistoryLedgerSequence(row.firstLedger, 'firstLedger'),
				lastBatchId: row.lastBatchId,
				nextLedger: fullHistoryUint64(row.nextLedger, 'nextLedger')
			};
}

export function assertReplayWatermark(
	watermark: FullHistoryWatermark | null,
	input: FullHistoryCheckpointWrite
): FullHistoryUint64String {
	const completedNext = incrementLedgerSequence(input.lastLedger);
	if (
		watermark === null ||
		BigInt(watermark.nextLedger) < BigInt(completedNext) ||
		(watermark.nextLedger === completedNext &&
			watermark.lastBatchId !== input.batchId)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Persisted batch and watermark are incomplete or inconsistent'
		);
	}
	return watermark.nextLedger;
}

export function assertWritableWatermark(
	watermark: FullHistoryWatermark | null,
	input: FullHistoryCheckpointWrite
): void {
	if (watermark !== null && watermark.nextLedger !== input.firstLedger) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			`Expected ledger ${watermark.nextLedger}, received ${input.firstLedger}`
		);
	}
}

export function assertPrependReplayFrontier(
	frontier: LockedFullHistoryHistoricalFrontier | null,
	input: FullHistoryCheckpointWrite
): LockedFullHistoryHistoricalFrontier {
	if (
		frontier === null ||
		BigInt(frontier.firstLedger) > BigInt(input.firstLedger) ||
		(frontier.firstLedger === input.firstLedger &&
			frontier.firstBatchId !== input.batchId)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Persisted historical batch is outside the canonical lower frontier'
		);
	}
	return frontier;
}

export function assertWritablePrependFrontier(
	frontier: LockedFullHistoryHistoricalFrontier | null,
	input: FullHistoryCheckpointWrite
): asserts frontier is LockedFullHistoryHistoricalFrontier {
	if (
		frontier === null ||
		incrementLedgerSequence(input.lastLedger) !== frontier.firstLedger
	) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			'Historical checkpoint is not immediately below the canonical frontier'
		);
	}
}

export async function assertPrependLedgerBoundary(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	frontier: LockedFullHistoryHistoricalFrontier
): Promise<void> {
	const finalLedger = input.ledgers.at(-1);
	if (finalLedger === undefined) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Historical checkpoint has no final ledger'
		);
	}
	const rows = (await manager.query(
		`
			select "previous_ledger_hash" as "previousLedgerHash"
			from "full_history_ledger"
			where "network_passphrase_hash" = $1 and "ledger_sequence" = $2
		`,
		[networkHash.toBuffer(), frontier.firstLedger]
	)) as Array<{ readonly previousLedgerHash: Uint8Array }>;
	const boundary = rows[0];
	if (
		boundary === undefined ||
		!FullHistoryHash.fromBytes(boundary.previousLedgerHash).equals(
			finalLedger.ledgerHash
		)
	) {
		throw new FullHistoryCanonicalError(
			'canonical-row-conflict',
			'Historical checkpoint does not join the canonical ledger hash chain'
		);
	}
}

export async function prependWatermark(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	current: LockedFullHistoryHistoricalFrontier
): Promise<LockedFullHistoryHistoricalFrontier> {
	await manager.query(
		`
			update "full_history_watermark"
			set "first_ledger" = $1, "first_batch_id" = $2,
				"updated_at" = now()
			where "network_passphrase_hash" = $3
				and "first_ledger" = $4 and "next_ledger" = $5
				and "last_batch_id" = $6
		`,
		[
			input.firstLedger,
			input.batchId,
			networkHash.toBuffer(),
			current.firstLedger,
			current.nextLedger,
			current.lastBatchId
		]
	);
	const updated = await lockHistoricalFrontier(manager, networkHash);
	if (
		updated === null ||
		updated.firstLedger !== input.firstLedger ||
		updated.firstBatchId !== input.batchId ||
		updated.nextLedger !== current.nextLedger ||
		updated.lastBatchId !== current.lastBatchId
	) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			'Canonical lower frontier changed during historical ingestion'
		);
	}
	return updated;
}

export async function advanceWatermark(
	manager: EntityManager,
	input: FullHistoryCheckpointWrite,
	networkHash: FullHistoryHash,
	current: FullHistoryWatermark | null
): Promise<FullHistoryUint64String> {
	const nextLedger = incrementLedgerSequence(input.lastLedger);
	if (current === null) {
		await manager.query(
			`
				insert into "full_history_watermark" (
					"network_passphrase_hash", "next_ledger", "last_batch_id"
				) values ($1, $2, $3)
			`,
			[networkHash.toBuffer(), nextLedger, input.batchId]
		);
		return nextLedger;
	}

	await manager.query(
		`
			update "full_history_watermark"
			set "next_ledger" = $1, "last_batch_id" = $2, "updated_at" = now()
			where "network_passphrase_hash" = $3 and "next_ledger" = $4
		`,
		[nextLedger, input.batchId, networkHash.toBuffer(), input.firstLedger]
	);
	const rows = (await manager.query(
		`
			select "next_ledger" as "nextLedger", "last_batch_id" as "lastBatchId"
			from "full_history_watermark" where "network_passphrase_hash" = $1
		`,
		[networkHash.toBuffer()]
	)) as Array<{ readonly lastBatchId: string; readonly nextLedger: string }>;
	if (
		rows[0]?.nextLedger !== nextLedger ||
		rows[0]?.lastBatchId !== input.batchId
	) {
		throw new FullHistoryCanonicalError(
			'watermark-gap',
			'Full-history watermark changed during canonical ingestion'
		);
	}
	return nextLedger;
}
