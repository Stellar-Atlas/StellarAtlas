import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import {
	CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
	type HistoryArchiveCheckpointProofFailureKind,
	type HistoryArchiveCheckpointProofStatus
} from '@history-scan-coordinator/domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';

export interface HistoricalFullHistoryCheckpointProofDTO {
	readonly checkpointLedger: string;
	readonly expectedBucketCount: number;
	readonly failedBucketCount: number;
	readonly failureKind: HistoryArchiveCheckpointProofFailureKind | null;
	readonly remainingBucketCount: number;
	readonly status: HistoryArchiveCheckpointProofStatus;
	readonly verifiedBucketCount: number;
}

export interface HistoricalFullHistoryBackfillDTO {
	readonly completedCheckpoints: number;
	readonly completedJobs: number;
	readonly currentProof: HistoricalFullHistoryCheckpointProofDTO | null;
	readonly failedJobs: number;
	readonly latestErrorCode: string | null;
	readonly nextCheckpointLedger: string | null;
	readonly pendingJobs: number;
	readonly runningJobs: number;
	readonly state:
		'complete' | 'failed' | 'idle' | 'queued' | 'running' | 'waiting-for-proof';
	readonly updatedAt: string | null;
}

interface HistoricalBackfillRow {
	readonly completedCheckpoints: number | string;
	readonly completedJobs: number | string;
	readonly firstLedger: number | string;
	readonly jobState: 'failed' | 'leased' | 'pending' | null;
	readonly leaseActive: boolean | null;
	readonly latestErrorCode: string | null;
	readonly proofCheckpointLedger: number | string | null;
	readonly proofExpectedBucketCount: number | string | null;
	readonly proofFailedBucketCount: number | string | null;
	readonly proofFailureKind: HistoryArchiveCheckpointProofFailureKind | null;
	readonly proofStatus: HistoryArchiveCheckpointProofStatus | null;
	readonly proofVerifiedBucketCount: number | string | null;
	readonly updatedAt: Date | string | null;
}

export async function readHistoricalFullHistoryBackfillStatus(
	dataSource: DataSource,
	networkPassphrase: string
): Promise<HistoricalFullHistoryBackfillDTO | null> {
	const networkHash = hashNetworkPassphrase(networkPassphrase);
	const rows = await dataSource.query<HistoricalBackfillRow[]>(
		`
				select
					completed."completedCheckpoints",
					completed."completedJobs",
					watermark."first_ledger"::text as "firstLedger",
					job.state as "jobState",
					job."leaseActive" as "leaseActive",
					job."last_error_code" as "latestErrorCode",
					current_proof."checkpointLedger" as "proofCheckpointLedger",
					current_proof."expectedBucketCount" as
						"proofExpectedBucketCount",
					current_proof."failedBucketCount" as
						"proofFailedBucketCount",
					current_proof."failureKind" as "proofFailureKind",
					current_proof.status as "proofStatus",
					current_proof."verifiedBucketCount" as
						"proofVerifiedBucketCount",
					job."updated_at" as "updatedAt"
				from "full_history_watermark" watermark
			left join lateral (
				select candidate.state,
					candidate."lease_expires_at" > now() as "leaseActive",
					candidate."last_error_code",
					candidate."updated_at"
				from "full_history_historical_backfill_job" candidate
				where candidate."network_passphrase_hash" =
						watermark."network_passphrase_hash"
					and candidate.state <> 'completed'
					and watermark."first_ledger" <=
						candidate."last_checkpoint_ledger" + 1
				order by candidate."last_checkpoint_ledger" desc,
					candidate."created_at", candidate.id
					limit 1
				) job on true
				left join lateral (
					select count(*)::integer as "completedJobs",
						coalesce(sum(
							(candidate."last_checkpoint_ledger" -
								candidate."first_checkpoint_ledger") / 64 + 1
						), 0)::integer as "completedCheckpoints"
					from "full_history_historical_backfill_job" candidate
					where candidate."network_passphrase_hash" =
						watermark."network_passphrase_hash"
						and candidate.state = 'completed'
				) completed on true
				left join lateral (
					select proof."checkpointLedger"::text as "checkpointLedger",
						proof."expectedBucketCount", proof."failedBucketCount",
						proof."failureKind",
						proof.status, proof."verifiedBucketCount"
					from "history_archive_state_snapshot" state
					join "history_archive_checkpoint_proof" proof
						on proof."archiveUrlIdentity" = state."archiveUrlIdentity"
						and proof."checkpointLedger" =
							watermark."first_ledger" - 1
					where state.status = 'available'
						and state."networkPassphrase" is not null
						and sha256(convert_to(state."networkPassphrase", 'UTF8')) =
							watermark."network_passphrase_hash"
						and proof."proofVersion" >=
							${CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION}
					order by
						(proof.status = 'verified') desc,
						(case when proof."proofFactsComplete" then 1::numeric
							else 0::numeric end + case
							when proof."expectedBucketCount" > 0 then
								proof."verifiedBucketCount"::numeric /
									proof."expectedBucketCount"::numeric
							else 0::numeric end) desc,
						proof."requiredObjectsComplete" desc,
						proof."verifiedBucketCount" desc,
						proof."missingBucketCount",
						proof."failedBucketCount",
						proof."evaluatedAt" desc,
						proof."archiveUrlIdentity"
					limit 1
				) current_proof on watermark."first_ledger" > 1
				where watermark."network_passphrase_hash" = $1
		`,
		[networkHash.toBuffer()]
	);
	return rows[0] === undefined ? null : mapHistoricalBackfill(rows[0]);
}

function mapHistoricalBackfill(
	row: HistoricalBackfillRow
): HistoricalFullHistoryBackfillDTO {
	const firstLedger = BigInt(row.firstLedger);
	const failedJobs = row.jobState === 'failed' ? 1 : 0;
	const runningJobs =
		row.jobState === 'leased' && row.leaseActive === true ? 1 : 0;
	const pendingJobs =
		row.jobState === 'pending' ||
		(row.jobState === 'leased' && row.leaseActive !== true)
			? 1
			: 0;
	const state: HistoricalFullHistoryBackfillDTO['state'] =
		firstLedger === 1n
			? 'complete'
			: failedJobs > 0
				? 'failed'
				: runningJobs > 0
					? 'running'
					: pendingJobs > 0 && row.latestErrorCode === 'proof-pending'
						? 'waiting-for-proof'
						: pendingJobs > 0
							? 'queued'
							: 'idle';
	return {
		completedCheckpoints: toCount(
			row.completedCheckpoints,
			'completedCheckpoints'
		),
		completedJobs: toCount(row.completedJobs, 'completedJobs'),
		currentProof: mapCurrentProof(row),
		failedJobs,
		latestErrorCode: row.latestErrorCode,
		nextCheckpointLedger:
			firstLedger === 1n ? null : (firstLedger - 1n).toString(),
		pendingJobs,
		runningJobs,
		state,
		updatedAt: toIso(row.updatedAt)
	};
}

function mapCurrentProof(
	row: HistoricalBackfillRow
): HistoricalFullHistoryCheckpointProofDTO | null {
	if (row.proofCheckpointLedger === null) return null;
	if (
		row.proofExpectedBucketCount === null ||
		row.proofFailedBucketCount === null ||
		row.proofStatus === null ||
		row.proofVerifiedBucketCount === null
	) {
		throw new TypeError('Incomplete historical checkpoint proof aggregate');
	}
	const expectedBucketCount = toCount(
		row.proofExpectedBucketCount,
		'proofExpectedBucketCount'
	);
	const verifiedBucketCount = toCount(
		row.proofVerifiedBucketCount,
		'proofVerifiedBucketCount'
	);
	const failedBucketCount = toCount(
		row.proofFailedBucketCount,
		'proofFailedBucketCount'
	);
	if (verifiedBucketCount > expectedBucketCount) {
		throw new RangeError(
			'Historical checkpoint proof verified bucket count exceeds expected count'
		);
	}
	if (failedBucketCount > expectedBucketCount - verifiedBucketCount) {
		throw new RangeError(
			'Historical checkpoint proof failed bucket count exceeds remaining count'
		);
	}
	return {
		checkpointLedger: BigInt(row.proofCheckpointLedger).toString(),
		expectedBucketCount,
		failedBucketCount,
		failureKind: row.proofFailureKind,
		remainingBucketCount: expectedBucketCount - verifiedBucketCount,
		status: row.proofStatus,
		verifiedBucketCount
	};
}

function toCount(value: number | string, field: string): number {
	const count = typeof value === 'number' ? value : Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TypeError(`Invalid historical backfill ${field}`);
	}
	return count;
}

function toIso(value: Date | string | null): string | null {
	if (value === null) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError('Invalid historical backfill timestamp');
	}
	return date.toISOString();
}
