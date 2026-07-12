import type { DataSource, QueryRunner } from 'typeorm';

const lockNamespace = 1_784_970_000;
const lockIdentity = 1;

interface LockRow {
	readonly acquired?: boolean;
}

export interface FullHistoryOperationBackfillLeadershipLease {
	readonly acquired: boolean;
	release(): Promise<void>;
}

export async function acquireFullHistoryOperationBackfillLeadership(
	dataSource: DataSource
): Promise<FullHistoryOperationBackfillLeadershipLease> {
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
): FullHistoryOperationBackfillLeadershipLease {
	let released = false;
	return {
		acquired,
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
