import type { DataSource } from 'typeorm';
import { hashNetworkPassphrase } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';

export interface HistoricalFullHistoryBackfillDTO {
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
	readonly firstLedger: number | string;
	readonly jobState: 'failed' | 'leased' | 'pending' | null;
	readonly latestErrorCode: string | null;
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
				job.state as "jobState",
				job."last_error_code" as "latestErrorCode",
				job."updated_at" as "updatedAt"
			from "full_history_watermark" watermark
			left join lateral (
				select candidate.state, candidate."last_error_code",
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
	const pendingJobs = row.jobState === 'pending' ? 1 : 0;
	const runningJobs = row.jobState === 'leased' ? 1 : 0;
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

function toIso(value: Date | string | null): string | null {
	if (value === null) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.valueOf())) {
		throw new TypeError('Invalid historical backfill timestamp');
	}
	return date.toISOString();
}
