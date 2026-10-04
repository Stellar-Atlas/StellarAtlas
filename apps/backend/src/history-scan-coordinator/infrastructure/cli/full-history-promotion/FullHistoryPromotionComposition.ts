import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { fullHistoryCanonicalEntities } from '../../database/full-history/FullHistoryCanonicalEntityRegistry.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import { TypeOrmFullHistoryPromotionFrontierRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryPromotionFrontierRepository.js';
import { TypeOrmFullHistoryPromotionRuntimeRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryPromotionRuntimeRepository.js';
import { PromoteNextFullHistoryCheckpoint } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';
import { PromoteFullHistoryCheckpoint } from '../../../use-cases/promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';
import { WorkerThreadFullHistoryCheckpointDecoder } from '../full-history-operation-backfill/WorkerThreadFullHistoryCheckpointDecoder.js';
import { VerifiedArchiveFullHistoryCheckpointCandidateRepository } from '../../full-history-promotion/VerifiedArchiveFullHistoryCheckpointCandidateRepository.js';
import { RemoteHistoryArchiveRepairObjectArtifactRepository } from '../../repositories/filesystem/RemoteHistoryArchiveRepairObjectArtifactRepository.js';
import { PostgresHistoryArchiveRepairArtifactWorkPermit } from '../../repositories/database/PostgresHistoryArchiveRepairArtifactWorkPermit.js';
import type { FullHistoryCheckpointCandidateRepository } from '../../../domain/full-history-promotion/FullHistoryCheckpointCandidateRepository.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function candidateRepository(
	dataSource: DataSource
): FullHistoryCheckpointCandidateRepository {
	const parsed = new TypeOrmFullHistoryCheckpointCandidateRepository(
		dataSource
	);
	if (process.env.FULL_HISTORY_PROMOTION_RAW_FALLBACK_ENABLED !== 'true')
		return parsed;
	return new VerifiedArchiveFullHistoryCheckpointCandidateRepository(
		parsed,
		new RemoteHistoryArchiveRepairObjectArtifactRepository({
			workPermit: new PostgresHistoryArchiveRepairArtifactWorkPermit(
				dataSource
			),
			stagingDirectory: join(tmpdir(), 'stellaratlas-promotion-raw-recovery'),
			maxConcurrentDownloads: 1,
			maxCompressedBytes: 64 * 1024 ** 2,
			maxUncompressedBytes: 64 * 1024 ** 2,
			timeoutMs: 20_000
		})
	);
}

export function createFullHistoryPromotionDataSource(poolSize = 2): DataSource {
	const options = AppDataSource.options;
	if (options.type !== 'postgres') {
		throw new Error(
			'Full-history promotion requires the PostgreSQL DataSource'
		);
	}
	return new DataSource({
		...options,
		entities: [...fullHistoryCanonicalEntities],
		migrationsRun: false,
		poolSize,
		synchronize: false
	});
}

export function composeFullHistoryCheckpointPromoter(
	dataSource: DataSource
): PromoteFullHistoryCheckpoint {
	return new PromoteFullHistoryCheckpoint(
		candidateRepository(dataSource),
		new WorkerThreadFullHistoryCheckpointDecoder(1),
		new TypeOrmFullHistoryCanonicalRepository(dataSource)
	);
}

export function composeNextFullHistoryCheckpointPromoter(
	dataSource: DataSource
): PromoteNextFullHistoryCheckpoint {
	const canonicalRepository = new TypeOrmFullHistoryCanonicalRepository(
		dataSource
	);
	return new PromoteNextFullHistoryCheckpoint(
		new TypeOrmFullHistoryPromotionFrontierRepository(
			dataSource,
			canonicalRepository
		),
		new PromoteFullHistoryCheckpoint(
			candidateRepository(dataSource),
			new WorkerThreadFullHistoryCheckpointDecoder(1),
			canonicalRepository
		)
	);
}

export function composeFullHistoryPromotionRuntimeRepository(
	dataSource: DataSource
): TypeOrmFullHistoryPromotionRuntimeRepository {
	return new TypeOrmFullHistoryPromotionRuntimeRepository(dataSource);
}
