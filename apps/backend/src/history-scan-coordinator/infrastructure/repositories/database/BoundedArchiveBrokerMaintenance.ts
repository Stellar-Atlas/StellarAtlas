import type { DataSource, EntityManager } from 'typeorm';
import { hasPostgresSqlState } from './PostgresError.js';

// Bounds apply per statement, only to optional ready-queue maintenance.
// A rejected transaction rolls back before publication is allowed to retry.
export async function withBoundedArchiveBrokerMaintenance<T>(
	dataSource: DataSource,
	maintain: (manager: EntityManager) => Promise<T>,
	onContention: T,
	reportDeferred?: (code: string) => void
): Promise<T> {
	try {
		return await dataSource.transaction(async (manager) => {
			await manager.query(
				"set local statement_timeout = '2s'; set local lock_timeout = '250ms'; set local jit = off"
			);
			return await maintain(manager);
		});
	} catch (error) {
		const code = ['57014', '55P03', '40P01'].find((state) =>
			hasPostgresSqlState(error, state)
		);
		if (code !== undefined) {
			reportDeferred?.(code);
			return onContention;
		}
		throw error;
	}
}
