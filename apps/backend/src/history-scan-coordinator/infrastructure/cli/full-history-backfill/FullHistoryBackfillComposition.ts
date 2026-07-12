import type { DataSource } from 'typeorm';
import { TypeOrmFullHistoryCanonicalRepository } from '../../database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { TypeOrmFullHistoryHistoricalBackfillRepository } from '../../database/full-history-backfill/TypeOrmFullHistoryHistoricalBackfillRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { PrependFullHistoryCheckpoint } from '../../../use-cases/prepend-full-history-checkpoint/PrependFullHistoryCheckpoint.js';
import { RunFullHistoryBackfill } from '../../../use-cases/run-full-history-backfill/RunFullHistoryBackfill.js';
import { ScheduleFullHistoryBackfill } from '../../../use-cases/schedule-full-history-backfill/ScheduleFullHistoryBackfill.js';
import { createFullHistoryPromotionDataSource } from '../full-history-promotion/FullHistoryPromotionComposition.js';
import { checkFullHistoryPromotionSchemaReadiness } from '../full-history-promotion/FullHistoryPromotionSchemaReadiness.js';

export interface FullHistoryBackfillSchemaReadiness {
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

export function createFullHistoryBackfillDataSource(): DataSource {
	return createFullHistoryPromotionDataSource();
}

export function composeFullHistoryBackfill(dataSource: DataSource): {
	readonly run: RunFullHistoryBackfill;
	readonly schedule: ScheduleFullHistoryBackfill;
} {
	const backfillRepository = new TypeOrmFullHistoryHistoricalBackfillRepository(
		dataSource
	);
	const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
		dataSource
	);
	return {
		run: new RunFullHistoryBackfill(
			backfillRepository,
			new PrependFullHistoryCheckpoint(
				new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
				new StellarFullHistoryCheckpointDecoder(),
				canonicalRepository
			)
		),
		schedule: new ScheduleFullHistoryBackfill(backfillRepository)
	};
}

export async function checkFullHistoryBackfillSchemaReadiness(
	dataSource: DataSource
): Promise<FullHistoryBackfillSchemaReadiness> {
	const promotion = await checkFullHistoryPromotionSchemaReadiness(dataSource);
	const rows = (await dataSource.query(
		`select
			to_regclass('full_history_historical_backfill_job') is not null as "jobTable",
			exists (
				select 1 from information_schema.columns
				where table_name = 'full_history_watermark'
					and column_name = 'first_ledger'
			) as "firstLedger",
			exists (
				select 1 from information_schema.columns
				where table_name = 'full_history_watermark'
					and column_name = 'first_batch_id'
			) as "firstBatchId"`
	)) as Array<{
		readonly firstBatchId: boolean;
		readonly firstLedger: boolean;
		readonly jobTable: boolean;
	}>;
	const row = rows[0];
	const missing = [...promotion.missingSchemaObjects];
	if (row?.jobTable !== true)
		missing.push('full_history_historical_backfill_job');
	if (row?.firstLedger !== true)
		missing.push('full_history_watermark.first_ledger');
	if (row?.firstBatchId !== true)
		missing.push('full_history_watermark.first_batch_id');
	return {
		missingSchemaObjects: [...new Set(missing)].sort(),
		pendingMigrations: promotion.pendingMigrations,
		ready: promotion.ready && missing.length === 0
	};
}
