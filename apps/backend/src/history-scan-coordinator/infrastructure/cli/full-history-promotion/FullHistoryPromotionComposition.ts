import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import { TypeOrmFullHistoryCanonicalRepository } from '../../database/full-history/TypeOrmFullHistoryCanonicalRepository.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../../database/full-history-promotion/TypeOrmFullHistoryCheckpointCandidateRepository.js';
import { StellarFullHistoryCheckpointDecoder } from '../../full-history-promotion/StellarFullHistoryCheckpointDecoder.js';
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
