import type { DataSource } from 'typeorm';
import type {
	FullHistoryLedgerCloseMetaDatabaseClient,
	FullHistoryLedgerCloseMetaDatabasePool
} from './FullHistoryLedgerCloseMetaAdmission.js';

type DatabaseConnection = Pick<
	FullHistoryLedgerCloseMetaDatabaseClient,
	'query'
>;
type DatabaseQuery = Parameters<
	FullHistoryLedgerCloseMetaDatabaseClient['query']
>[0];
type DatabaseRelease = (error?: Error) => void;

export function typeOrmFullHistoryLedgerCloseMetaDatabasePool(
	dataSource: DataSource
): FullHistoryLedgerCloseMetaDatabasePool {
	return Object.freeze({
		connect: async () => {
			const driver: unknown = dataSource.driver;
			if (!isPostgresDriver(driver)) {
				throw new Error('PostgreSQL admission pool is unavailable');
			}
			const lease = await driver.obtainMasterConnection();
			if (!isDatabaseLease(lease)) {
				throw new Error('PostgreSQL admission client is invalid');
			}
			const [connection, release] = lease;
			return Object.freeze({
				query: (query: DatabaseQuery) => connection.query(query),
				release: (error?: Error) => release(error)
			});
		}
	});
}

interface PostgresDriver {
	obtainMasterConnection(): Promise<unknown>;
}

function isPostgresDriver(value: unknown): value is PostgresDriver {
	return (
		typeof value === 'object' &&
		value !== null &&
		typeof Reflect.get(value, 'obtainMasterConnection') === 'function'
	);
}

function isDatabaseLease(
	value: unknown
): value is [DatabaseConnection, DatabaseRelease] {
	return (
		Array.isArray(value) &&
		value.length === 2 &&
		typeof value[0] === 'object' &&
		value[0] !== null &&
		typeof Reflect.get(value[0], 'query') === 'function' &&
		typeof value[1] === 'function'
	);
}
