import type { DataSource } from 'typeorm';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../database/full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { BackfillFullHistoryOperations } from '../../../use-cases/backfill-full-history-operations/BackfillFullHistoryOperations.js';
import { createFullHistoryPromotionDataSource } from '../full-history-promotion/FullHistoryPromotionComposition.js';
import { checkFullHistoryPromotionSchemaReadiness } from '../full-history-promotion/FullHistoryPromotionSchemaReadiness.js';

export interface FullHistoryOperationBackfillReadiness {
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

export function createFullHistoryOperationBackfillDataSource(): DataSource {
	return createFullHistoryPromotionDataSource();
}

export function composeFullHistoryOperationBackfill(
	dataSource: DataSource
): BackfillFullHistoryOperations {
	return new BackfillFullHistoryOperations(
		new TypeOrmFullHistoryOperationBackfillRepository(dataSource),
		new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
		new StellarFullHistoryCheckpointDecoder()
	);
}

export async function checkFullHistoryOperationBackfillReadiness(
	dataSource: DataSource
): Promise<FullHistoryOperationBackfillReadiness> {
	const promotion = await checkFullHistoryPromotionSchemaReadiness(dataSource);
	const rows = (await dataSource.query(
		`select exists (
			select 1 from information_schema.columns
			where table_name = 'full_history_operation_batch_coverage'
				and column_name = 'operation_decoder_version'
		) as "decoderVersion"`
	)) as readonly { readonly decoderVersion: boolean }[];
	const missing = [...promotion.missingSchemaObjects];
	if (rows[0]?.decoderVersion !== true) {
		missing.push(
			'full_history_operation_batch_coverage.operation_decoder_version'
		);
	}
	return {
		missingSchemaObjects: [...new Set(missing)].sort(),
		pendingMigrations: promotion.pendingMigrations,
		ready: promotion.ready && missing.length === 0
	};
}
