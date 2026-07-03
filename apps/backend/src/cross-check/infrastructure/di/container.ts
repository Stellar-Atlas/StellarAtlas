import { interfaces } from 'inversify';
import { DataSource } from 'typeorm';
import { CROSS_CHECK_TYPES } from '../../domain/CrossCheckTypes.js';
import { GetCrossCheckArchives } from '../../use-cases/get-cross-check-archives/GetCrossCheckArchives.js';
import { GetCrossCheckOrganizations } from '../../use-cases/get-cross-check-organizations/GetCrossCheckOrganizations.js';
import { GetCrossCheckSources } from '../../use-cases/get-cross-check-sources/GetCrossCheckSources.js';
import { GetCrossCheckValidators } from '../../use-cases/get-cross-check-validators/GetCrossCheckValidators.js';
import type { CrossCheckApiDocsComparisonSnapshotRepository } from '../../domain/CrossCheckApiDocsSnapshot.js';
import { CrossCheckApiDocsComparisonSnapshot } from '../database/entities/CrossCheckApiDocsComparisonSnapshot.js';
import { TypeOrmCrossCheckApiDocsComparisonSnapshotRepository } from '../database/repositories/TypeOrmCrossCheckApiDocsComparisonSnapshotRepository.js';
import { GetApiDocsComparisonSnapshot } from '../../use-cases/get-api-docs-comparison-snapshot/GetApiDocsComparisonSnapshot.js';
import { ListApiDocsComparisonSnapshots } from '../../use-cases/list-api-docs-comparison-snapshots/ListApiDocsComparisonSnapshots.js';
import Container = interfaces.Container;

export function load(container: Container) {
	const dataSource = container.get(DataSource);

	container
		.bind<CrossCheckApiDocsComparisonSnapshotRepository>(
			CROSS_CHECK_TYPES.ApiDocsComparisonSnapshotRepository
		)
		.toDynamicValue(() => {
			return new TypeOrmCrossCheckApiDocsComparisonSnapshotRepository(
				dataSource.getRepository(CrossCheckApiDocsComparisonSnapshot)
			);
		});

	container.bind(GetApiDocsComparisonSnapshot).toSelf();
	container.bind(ListApiDocsComparisonSnapshots).toSelf();
	container.bind(GetCrossCheckArchives).toSelf();
	container.bind(GetCrossCheckOrganizations).toSelf();
	container.bind(GetCrossCheckSources).toSelf();
	container.bind(GetCrossCheckValidators).toSelf();
}
