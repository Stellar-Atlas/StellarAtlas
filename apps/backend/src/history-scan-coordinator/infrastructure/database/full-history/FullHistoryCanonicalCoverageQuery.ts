import type { DataSource } from 'typeorm';
import type {
	FullHistoryCanonicalCoverageView,
	FullHistoryCanonicalLatestEvidenceView
} from '../../../domain/full-history/FullHistoryCanonicalRepository.js';
import {
	assertUuid,
	FullHistoryHash,
	fullHistoryLedgerSequence,
	fullHistoryUint64
} from '../../../domain/full-history/FullHistoryCanonicalTypes.js';

interface CoverageRow {
	readonly archiveSourceCount: number | string;
	readonly batchCount: number | string;
	readonly checkpointLedger: string;
	readonly checkpointProofId: number | string;
	readonly checkpointStateContentDigest: Uint8Array;
	readonly checkpointStateObjectRemoteId: string;
	readonly decoderVersion: string;
	readonly firstLedger: string;
	readonly ingestedAt: Date | string;
	readonly lastLedger: string;
	readonly latestArchiveUrlIdentity: string;
	readonly latestBatchFirstLedger: string;
	readonly latestBatchId: string;
	readonly latestBatchLastLedger: string;
	readonly latestLedgerClosedAt: Date | string;
	readonly ledgerContentDigest: Uint8Array;
	readonly ledgerCount: number | string;
	readonly ledgerObjectRemoteId: string;
	readonly nextLedger: string;
	readonly proofEvaluatedAt: Date | string;
	readonly proofVersion: number | string;
	readonly resultsContentDigest: Uint8Array;
	readonly resultsObjectRemoteId: string;
	readonly transactionCount: number | string;
	readonly transactionResultCount: number | string;
	readonly transactionsContentDigest: Uint8Array;
	readonly transactionsObjectRemoteId: string;
	readonly updatedAt: Date | string;
}

export async function getCanonicalCoverage(
	dataSource: DataSource,
	networkHash: FullHistoryHash
): Promise<FullHistoryCanonicalCoverageView | null> {
	const rows = await dataSource.query<CoverageRow[]>(coverageSql, [
		networkHash.toBuffer()
	]);
	const row = rows[0];
	if (row === undefined) return null;
	return {
		archiveSourceCount: safeCount(row.archiveSourceCount, 'archiveSourceCount'),
		batchCount: safeCount(row.batchCount, 'batchCount'),
		firstLedger: fullHistoryLedgerSequence(row.firstLedger, 'firstLedger'),
		lastLedger: fullHistoryLedgerSequence(row.lastLedger, 'lastLedger'),
		latestEvidence: mapLatestEvidence(row),
		latestLedgerClosedAt: validDate(row.latestLedgerClosedAt),
		ledgerCount: safeCount(row.ledgerCount, 'ledgerCount'),
		nextLedger: fullHistoryUint64(row.nextLedger, 'nextLedger'),
		transactionCount: safeCount(row.transactionCount, 'transactionCount'),
		transactionResultCount: safeCount(
			row.transactionResultCount,
			'transactionResultCount'
		),
		updatedAt: validDate(row.updatedAt)
	};
}

const coverageSql = `
	select
		aggregate."archiveSourceCount", aggregate."batchCount",
		latest_batch."checkpoint_ledger"::text as "checkpointLedger",
		latest_batch."checkpoint_proof_id"::text as "checkpointProofId",
		latest_batch."checkpoint_state_content_digest" as
			"checkpointStateContentDigest",
		latest_batch."checkpoint_state_object_remote_id" as
			"checkpointStateObjectRemoteId",
		latest_batch."decoder_version" as "decoderVersion",
		aggregate."firstLedger", latest_batch."ingested_at" as "ingestedAt",
		aggregate."lastLedger",
		latest_batch."archive_url_identity" as "latestArchiveUrlIdentity",
		latest_batch.id as "latestBatchId",
		latest_batch."first_ledger"::text as "latestBatchFirstLedger",
		latest_batch."last_ledger"::text as "latestBatchLastLedger",
		latest_ledger."closed_at" as "latestLedgerClosedAt",
		aggregate."ledgerCount",
		latest_batch."ledger_content_digest" as "ledgerContentDigest",
		latest_batch."ledger_object_remote_id" as "ledgerObjectRemoteId",
		watermark."next_ledger"::text as "nextLedger",
		latest_batch."proof_evaluated_at" as "proofEvaluatedAt",
		latest_batch."proof_version"::text as "proofVersion",
		latest_batch."results_content_digest" as "resultsContentDigest",
		latest_batch."results_object_remote_id" as "resultsObjectRemoteId",
		aggregate."transactionCount", aggregate."transactionResultCount",
		latest_batch."transactions_content_digest" as
			"transactionsContentDigest",
		latest_batch."transactions_object_remote_id" as
			"transactionsObjectRemoteId",
		watermark."updated_at" as "updatedAt"
	from "full_history_watermark" watermark
	join "full_history_ingestion_batch" latest_batch
		on latest_batch.id = watermark."last_batch_id"
		and latest_batch."network_passphrase_hash" =
			watermark."network_passphrase_hash"
	join "full_history_ledger" latest_ledger
		on latest_ledger."network_passphrase_hash" =
			watermark."network_passphrase_hash"
		and latest_ledger."ledger_sequence" = watermark."next_ledger" - 1
	cross join lateral (
		select
			count(distinct batch."archive_url_identity")::text as
				"archiveSourceCount",
			count(batch.id)::text as "batchCount",
			min(batch."first_ledger")::text as "firstLedger",
			max(batch."last_ledger")::text as "lastLedger",
			sum(batch."ledger_count")::text as "ledgerCount",
			sum(batch."transaction_count")::text as "transactionCount",
			sum(batch."result_count")::text as "transactionResultCount"
		from "full_history_ingestion_batch" batch
		where batch."network_passphrase_hash" = watermark."network_passphrase_hash"
	) aggregate
	where watermark."network_passphrase_hash" = $1
`;

function mapLatestEvidence(
	row: CoverageRow
): FullHistoryCanonicalLatestEvidenceView {
	return {
		archiveUrlIdentity: row.latestArchiveUrlIdentity,
		batchId: assertUuid(row.latestBatchId, 'latestBatchId'),
		checkpointLedger: fullHistoryLedgerSequence(
			row.checkpointLedger,
			'checkpointLedger'
		),
		checkpointProofId: safeCount(row.checkpointProofId, 'checkpointProofId'),
		decoderVersion: row.decoderVersion,
		firstLedger: fullHistoryLedgerSequence(
			row.latestBatchFirstLedger,
			'latestBatchFirstLedger'
		),
		ingestedAt: validDate(row.ingestedAt),
		lastLedger: fullHistoryLedgerSequence(
			row.latestBatchLastLedger,
			'latestBatchLastLedger'
		),
		proofEvaluatedAt: validDate(row.proofEvaluatedAt),
		proofVersion: safeCount(row.proofVersion, 'proofVersion'),
		sourceObjects: {
			checkpointState: sourceObject(
				row.checkpointStateObjectRemoteId,
				row.checkpointStateContentDigest,
				'checkpointStateObjectRemoteId'
			),
			ledger: sourceObject(
				row.ledgerObjectRemoteId,
				row.ledgerContentDigest,
				'ledgerObjectRemoteId'
			),
			results: sourceObject(
				row.resultsObjectRemoteId,
				row.resultsContentDigest,
				'resultsObjectRemoteId'
			),
			transactions: sourceObject(
				row.transactionsObjectRemoteId,
				row.transactionsContentDigest,
				'transactionsObjectRemoteId'
			)
		}
	};
}

function sourceObject(
	remoteId: string,
	digest: Uint8Array,
	field: string
): FullHistoryCanonicalLatestEvidenceView['sourceObjects']['ledger'] {
	return {
		contentDigest: FullHistoryHash.fromBytes(digest),
		objectRemoteId: assertUuid(remoteId, field)
	};
}

function validDate(value: Date | string): Date {
	const date =
		value instanceof Date ? new Date(value.getTime()) : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new TypeError(
			'PostgreSQL returned an invalid full-history timestamp'
		);
	}
	return date;
}

function safeCount(value: number | string, field: string): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new RangeError(`${field} is outside the safe count range`);
	}
	return parsed;
}
