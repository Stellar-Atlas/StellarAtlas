import type { DataSource, EntityManager } from 'typeorm';
import { ArchiveEvidenceReadModelUnavailableError } from '../../../domain/known-archive-evidence/ArchiveEvidenceReadModelUnavailableError.js';
import { hasPostgresSqlState } from './PostgresError.js';

// Public pagination must not leave an unbounded scan running after its caller
// gives up. TypeORM rolls back on rejection and releases the query runner.
export async function withBoundedArchiveEvidenceRead<T>(
	dataSource: DataSource,
	read: (manager: EntityManager) => Promise<T>
): Promise<T> {
	try {
		return await dataSource.transaction('REPEATABLE READ', async (manager) => {
			await manager.query(
				"set transaction read only; set local statement_timeout = '5s'; set local lock_timeout = '250ms'"
			);
			return await read(manager);
		});
	} catch (error) {
		if (
			hasPostgresSqlState(error, '57014') ||
			hasPostgresSqlState(error, '55P03')
		) {
			throw new ArchiveEvidenceReadModelUnavailableError(
				'Archive evidence page exceeded its read time limit; retry shortly'
			);
		}
		throw error;
	}
}
