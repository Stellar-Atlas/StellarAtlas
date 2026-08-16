import type { DataSource, QueryRunner } from 'typeorm';
import type {
	HistoryArchiveRepairArtifactWorkLease,
	HistoryArchiveRepairArtifactWorkPermit
} from '../../../domain/history-archive-repair-artifact/HistoryArchiveRepairArtifactWorkPermit.js';

const advisoryLockNamespace = 'history-archive-repair-artifact-v1';
const defaultGlobalSlots = 2;

type LockRow = { readonly acquired?: boolean };

export class PostgresHistoryArchiveRepairArtifactWorkPermit implements HistoryArchiveRepairArtifactWorkPermit {
	constructor(
		private readonly dataSource: DataSource,
		private readonly slotCount = defaultGlobalSlots
	) {
		if (!Number.isSafeInteger(slotCount) || slotCount < 1 || slotCount > 8) {
			throw new RangeError(
				'Repair artifact slot count must be between 1 and 8'
			);
		}
	}

	async tryAcquire(): Promise<HistoryArchiveRepairArtifactWorkLease | null> {
		const queryRunner = this.dataSource.createQueryRunner();
		let leaseOwnsRunner = false;
		try {
			await queryRunner.connect();
			for (let slot = 0; slot < this.slotCount; slot++) {
				const rows = (await queryRunner.query(
					`select pg_try_advisory_lock(hashtext($1), $2::integer) as "acquired"`,
					[advisoryLockNamespace, slot]
				)) as LockRow[];
				if (rows[0]?.acquired !== true) continue;

				leaseOwnsRunner = true;
				return createLease(queryRunner, slot);
			}
			return null;
		} catch (error) {
			leaseOwnsRunner = true;
			discardQueryRunner(queryRunner, toError(error));
			return null;
		} finally {
			if (!leaseOwnsRunner) await queryRunner.release().catch(() => undefined);
		}
	}
}

function createLease(
	queryRunner: QueryRunner,
	slot: number
): HistoryArchiveRepairArtifactWorkLease {
	let released = false;
	return {
		async release(): Promise<void> {
			if (released) return;
			released = true;
			let safeToPool = false;
			try {
				const rows = (await queryRunner.query(
					`select pg_advisory_unlock(hashtext($1), $2::integer)`,
					[advisoryLockNamespace, slot]
				)) as { readonly pg_advisory_unlock?: boolean }[];
				safeToPool = rows[0]?.pg_advisory_unlock === true;
				if (!safeToPool)
					throw new Error('Repair artifact advisory slot was lost');
			} catch (error) {
				try {
					await queryRunner.query('select pg_advisory_unlock_all()');
					safeToPool = true;
				} catch {
					discardQueryRunner(queryRunner, toError(error));
				}
			} finally {
				if (safeToPool) {
					await queryRunner.release().catch(() => undefined);
				}
			}
		}
	};
}

type InternalPostgresQueryRunner = QueryRunner & {
	driver?: { connectedQueryRunners?: QueryRunner[] };
	isReleased?: boolean;
	releaseCallback?: (error?: Error) => void;
};

/**
 * TypeORM 0.3.x does not expose release(error), although its Postgres runner
 * uses that exact callback to make pg-pool destroy a tainted session. Never
 * return a session whose advisory-lock state is unknown to the pool.
 */
function discardQueryRunner(queryRunner: QueryRunner, error: Error): void {
	const internal = queryRunner as InternalPostgresQueryRunner;
	if (internal.isReleased === true) return;
	internal.isReleased = true;
	try {
		internal.releaseCallback?.(error);
	} catch {
		// The session is already being discarded; release must stay non-throwing.
	}
	internal.releaseCallback = undefined;
	const connected = internal.driver?.connectedQueryRunners;
	const index = connected?.indexOf(queryRunner) ?? -1;
	if (index >= 0) connected?.splice(index, 1);
}

function toError(value: unknown): Error {
	return value instanceof Error ? value : new Error('Database session failed');
}
