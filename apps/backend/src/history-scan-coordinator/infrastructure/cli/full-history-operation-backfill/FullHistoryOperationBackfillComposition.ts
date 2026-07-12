import type { DataSource } from 'typeorm';
import { TypeOrmFullHistoryOperationBackfillRepository } from '../../database/full-history-operation-backfill/TypeOrmFullHistoryOperationBackfillRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import {
	BackfillFullHistoryOperations,
	type BackfillFullHistoryOperationsInput,
	type BackfillFullHistoryOperationsResult
} from '../../../use-cases/backfill-full-history-operations/BackfillFullHistoryOperations.js';
import { FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_DEFAULT } from '../../../domain/full-history-operation-backfill/FullHistoryOperationBackfill.js';
import { createFullHistoryPromotionDataSource } from '../full-history-promotion/FullHistoryPromotionComposition.js';
import { checkFullHistoryPromotionSchemaReadiness } from '../full-history-promotion/FullHistoryPromotionSchemaReadiness.js';
import {
	WorkerThreadFullHistoryCheckpointDecoder,
	type FullHistoryOperationWorkerMetrics
} from './WorkerThreadFullHistoryCheckpointDecoder.js';

export interface FullHistoryOperationBackfillReadiness {
	readonly missingSchemaObjects: readonly string[];
	readonly pendingMigrations: boolean;
	readonly ready: boolean;
}

export interface FullHistoryOperationBackfillExecutionResult extends BackfillFullHistoryOperationsResult {
	readonly workerMetrics: FullHistoryOperationWorkerMetrics;
}

export class FullHistoryOperationBackfillExecutionError extends Error {
	constructor(
		readonly workerMetrics: FullHistoryOperationWorkerMetrics,
		cause: unknown
	) {
		super(
			cause instanceof Error
				? cause.message
				: 'Full-history operation backfill execution failed',
			{ cause }
		);
		this.name = 'FullHistoryOperationBackfillExecutionError';
	}
}

export function createFullHistoryOperationBackfillDataSource(): DataSource {
	return createFullHistoryPromotionDataSource();
}

export function composeFullHistoryOperationBackfill(
	dataSource: DataSource,
	cpuWorkerCount = FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS_DEFAULT
): BackfillFullHistoryOperations {
	return new BackfillFullHistoryOperations(
		new TypeOrmFullHistoryOperationBackfillRepository(dataSource),
		new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
		new WorkerThreadFullHistoryCheckpointDecoder(cpuWorkerCount)
	);
}

export async function executeFullHistoryOperationBackfill(
	dataSource: DataSource,
	input: BackfillFullHistoryOperationsInput
): Promise<FullHistoryOperationBackfillExecutionResult> {
	const decoder = new WorkerThreadFullHistoryCheckpointDecoder(
		input.cpuWorkerCount
	);
	try {
		const result = await new BackfillFullHistoryOperations(
			new TypeOrmFullHistoryOperationBackfillRepository(dataSource),
			new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
			decoder
		).execute(input);
		return { ...result, workerMetrics: decoder.metrics() };
	} catch (error) {
		throw new FullHistoryOperationBackfillExecutionError(
			decoder.metrics(),
			error
		);
	}
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
