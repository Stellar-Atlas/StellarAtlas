import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { TypeOrmFullHistoryStateImportRepository } from '../../database/full-history-state-import/TypeOrmFullHistoryStateImportRepository.js';
import { TypeOrmFullHistoryStateCanonicalCoverageRepository } from '../../database/full-history-state-import/TypeOrmFullHistoryStateCanonicalCoverageRepository.js';
import { GoFullHistoryLedgerExporter } from '../../full-history-state-import/GoFullHistoryLedgerExporter.js';
import { GoFullHistoryStateExporter } from '../../full-history-state-import/GoFullHistoryStateExporter.js';
import { BindNextFullHistoryStateCoverage } from '../../../use-cases/bind-next-full-history-state-coverage/BindNextFullHistoryStateCoverage.js';
import { ImportNextFullHistoryStateDataset } from '../../../use-cases/import-next-full-history-state-dataset/ImportNextFullHistoryStateDataset.js';
import {
	FULL_HISTORY_STATE_IMPORT_MAXIMUM_DATABASE_POOL_SIZE,
	type FullHistoryStateImportServiceConfig
} from './FullHistoryStateImportServiceConfig.js';
import type { FullHistoryStateWorkerReceipt } from './FullHistoryStateImportWorkerLoop.js';

export interface FullHistoryStateImportWorker {
	readonly execute: (
		signal: AbortSignal
	) => Promise<FullHistoryStateWorkerReceipt | null>;
	readonly workerId: string;
	readonly workerIndex: number;
}

export function createFullHistoryStateImportDataSource(
	poolSize: number
): DataSource {
	if (
		!Number.isInteger(poolSize) ||
		poolSize < 3 ||
		poolSize > FULL_HISTORY_STATE_IMPORT_MAXIMUM_DATABASE_POOL_SIZE
	) {
		throw new RangeError(
			'State-import database pool size is outside its bounds'
		);
	}
	const options = AppDataSource.options;
	if (options.type !== 'postgres') {
		throw new Error('Full-history state import requires PostgreSQL');
	}
	return new DataSource({
		...options,
		entities: [],
		migrationsRun: false,
		poolSize,
		synchronize: false
	});
}

export function composeFullHistoryStateImportWorkers(
	dataSource: DataSource,
	config: FullHistoryStateImportServiceConfig,
	createWorkerId: () => string = randomUUID
): readonly FullHistoryStateImportWorker[] {
	const repository = new TypeOrmFullHistoryStateImportRepository(dataSource);
	const coverageRepository =
		new TypeOrmFullHistoryStateCanonicalCoverageRepository(dataSource);
	const exporter = new GoFullHistoryStateExporter(
		config.executablePath,
		config.exportTimeoutMilliseconds
	);
	const ledgerExporter = new GoFullHistoryLedgerExporter(
		config.executablePath,
		config.exportTimeoutMilliseconds
	);
	const workerIds = new Set<string>();
	const workers = Array.from({ length: config.workerCount }, (_, index) => {
		const workerId = createWorkerId();
		if (workerIds.has(workerId)) {
			throw new Error('State-import workers must have distinct lease owners');
		}
		workerIds.add(workerId);
		const importer = new ImportNextFullHistoryStateDataset(
			repository,
			exporter,
			{
				insertBatchSize: config.insertBatchSize,
				leaseDurationMilliseconds: config.leaseDurationMilliseconds,
				storageRoot: config.storageRoot,
				workerId
			}
		);
		const coverage = new BindNextFullHistoryStateCoverage(
			coverageRepository,
			ledgerExporter,
			{
				insertBatchSize: config.insertBatchSize,
				leaseDurationMilliseconds: config.leaseDurationMilliseconds,
				storageRoot: config.storageRoot,
				workerId
			}
		);
		let coverageFirst = index % 2 === 0;
		return Object.freeze({
			execute: async (signal: AbortSignal) => {
				const firstCoverage = coverageFirst;
				coverageFirst = !coverageFirst;
				if (firstCoverage) {
					const bound = await coverage.execute(signal);
					if (bound !== null) {
						return { kind: 'canonical-coverage' as const, receipt: bound };
					}
				}
				const imported = await importer.execute(signal);
				if (imported !== null) {
					return { kind: 'state-import' as const, receipt: imported };
				}
				if (!firstCoverage) {
					const bound = await coverage.execute(signal);
					if (bound !== null) {
						return { kind: 'canonical-coverage' as const, receipt: bound };
					}
				}
				return null;
			},
			workerId,
			workerIndex: index + 1
		});
	});
	return Object.freeze(workers);
}
