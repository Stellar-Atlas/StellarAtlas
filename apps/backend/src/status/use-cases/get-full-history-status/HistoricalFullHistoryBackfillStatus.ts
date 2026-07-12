import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';

export interface HistoricalFullHistoryBackfillDTO {
	readonly completedCheckpoints: number;
	readonly failedJobs: number;
	readonly latestCompletedAt: string | null;
	readonly latestErrorCode: string | null;
	readonly nextCheckpointLedger: string | null;
	readonly pendingJobs: number;
	readonly runningJobs: number;
	readonly state:
		'complete' | 'failed' | 'idle' | 'queued' | 'running' | 'waiting-for-proof';
	readonly updatedAt: string | null;
}

interface HistoricalBackfillRow {
	readonly completedCheckpoints: number | string | null;
	readonly failedJobs: number | string | null;
	readonly firstLedger: number | string;
	readonly latestCompletedAt: Date | string | null;
	readonly latestErrorCode: string | null;
	readonly pendingJobs: number | string | null;
	readonly runningJobs: number | string | null;
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
				watermark."first_ledger"::text as "firstLedger",
				coalesce(sum(
					((job."last_checkpoint_ledger" - job."first_checkpoint_ledger") / 64) + 1
				) filter (where job.state = 'completed'), 0)::text
					as "completedCheckpoints",
				count(*) filter (
					where job.state = 'pending'
						and watermark."first_ledger" <= job."last_checkpoint_ledger" + 1
				)::text as "pendingJobs",
				count(*) filter (
					where job.state = 'leased'
						and watermark."first_ledger" <= job."last_checkpoint_ledger" + 1
				)::text as "runningJobs",
				count(*) filter (
					where job.state = 'failed'
						and watermark."first_ledger" <= job."last_checkpoint_ledger" + 1
				)::text as "failedJobs",
				(array_agg(job."last_error_code" order by job."updated_at" desc)
					filter (where job.state <> 'completed'
						and watermark."first_ledger" <= job."last_checkpoint_ledger" + 1)
				)[1] as "latestErrorCode",
				max(job."completed_at") as "latestCompletedAt",
				max(job."updated_at") as "updatedAt"
			from "full_history_watermark" watermark
			left join "full_history_historical_backfill_job" job
				on job."network_passphrase_hash" =
					watermark."network_passphrase_hash"
			where watermark."network_passphrase_hash" = $1
			group by watermark."first_ledger"
		`,
		[networkHash.toBuffer()]
	);
	return rows[0] === undefined ? null : mapHistoricalBackfill(rows[0]);
}

function mapHistoricalBackfill(
	row: HistoricalBackfillRow
): HistoricalFullHistoryBackfillDTO {
	const firstLedger = BigInt(row.firstLedger);
	const completedCheckpoints = toCount(row.completedCheckpoints);
	const failedJobs = toCount(row.failedJobs);
	const pendingJobs = toCount(row.pendingJobs);
	const runningJobs = toCount(row.runningJobs);
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
		completedCheckpoints,
		failedJobs,
		latestCompletedAt: toIso(row.latestCompletedAt),
		latestErrorCode: row.latestErrorCode,
		nextCheckpointLedger:
			firstLedger === 1n ? null : (firstLedger - 1n).toString(),
		pendingJobs,
		runningJobs,
		state,
		updatedAt: toIso(row.updatedAt)
	};
}

function toCount(value: number | string | null): number {
	const count = value === null ? 0 : Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new TypeError('Invalid historical backfill count');
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
