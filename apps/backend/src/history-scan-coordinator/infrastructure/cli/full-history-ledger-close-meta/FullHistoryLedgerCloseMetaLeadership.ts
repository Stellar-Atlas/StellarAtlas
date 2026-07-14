import type { DataSource, QueryRunner } from 'typeorm';

const lockNamespace = 1_785_070_000;
const lockIdentity = 1;

interface LockRow {
	readonly acquired?: boolean;
	readonly held?: boolean;
}

export interface FullHistoryLedgerCloseMetaLeadershipLease {
	readonly acquired: boolean;
	assertHeld(): Promise<void>;
	release(): Promise<void>;
}

export async function acquireFullHistoryLedgerCloseMetaLeadership(
	dataSource: DataSource
): Promise<FullHistoryLedgerCloseMetaLeadershipLease> {
	const queryRunner = dataSource.createQueryRunner();
	await queryRunner.connect();
	try {
		const rows = (await queryRunner.query(
			`select pg_try_advisory_lock($1, $2) as "acquired"`,
			[lockNamespace, lockIdentity]
		)) as LockRow[];
		return leadershipLease(queryRunner, rows[0]?.acquired === true);
	} catch (error) {
		await queryRunner.release().catch(() => undefined);
		throw error;
	}
}

function leadershipLease(
	queryRunner: QueryRunner,
	acquired: boolean
): FullHistoryLedgerCloseMetaLeadershipLease {
	let released = false;
	return {
		acquired,
		assertHeld: async () => {
			if (!acquired || released) {
				throw new Error('Full-history LedgerCloseMeta leadership is not held');
			}
			const rows = (await queryRunner.query(
				`select exists (
					select 1 from pg_locks
					where "locktype" = 'advisory' and "pid" = pg_backend_pid()
						and "granted" and "classid"::bigint = $1
						and "objid"::bigint = $2
				) as "held"`,
				[lockNamespace, lockIdentity]
			)) as LockRow[];
			if (rows.length !== 1 || rows[0]?.held !== true) {
				throw new Error('Full-history LedgerCloseMeta leadership was lost');
			}
		},
		release: async () => {
			if (released) return;
			released = true;
			try {
				if (acquired) {
					await queryRunner.query(`select pg_advisory_unlock($1, $2)`, [
						lockNamespace,
						lockIdentity
					]);
				}
			} finally {
				await queryRunner.release();
			}
		}
	};
}
