import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { fullHistoryCanonicalEntities } from '../../database/full-history/FullHistoryCanonicalEntityRegistry.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import { TypeOrmFullHistoryPromotionFrontierRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryPromotionFrontierRepository.js';
import { TypeOrmFullHistoryPromotionRuntimeRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryPromotionRuntimeRepository.js';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
import { PromoteNextFullHistoryCheckpoint } from '../../../use-cases/promote-next-full-history-checkpoint/PromoteNextFullHistoryCheckpoint.js';
import { PromoteFullHistoryCheckpoint } from '../../../use-cases/promote-full-history-checkpoint/PromoteFullHistoryCheckpoint.js';

export function createFullHistoryPromotionDataSource(): DataSource {
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
		poolSize: 2,
		synchronize: false
	});
}

export function composeFullHistoryCheckpointPromoter(
	dataSource: DataSource
): PromoteFullHistoryCheckpoint {
	return new PromoteFullHistoryCheckpoint(
		new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
		new StellarFullHistoryCheckpointDecoder(),
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
			new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource),
			new StellarFullHistoryCheckpointDecoder(),
			canonicalRepository
		)
	);
}

export function composeFullHistoryPromotionRuntimeRepository(
	dataSource: DataSource
): TypeOrmFullHistoryPromotionRuntimeRepository {
	return new TypeOrmFullHistoryPromotionRuntimeRepository(dataSource);
}
