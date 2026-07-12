import { DataSource } from 'typeorm';
import {
	startDisposablePostgres,
	type DisposablePostgres
} from '@test-support/DisposablePostgres.js';
import { HistoryArchiveCheckpointProofRollupMigration1784830000000 } from '../1784830000000-HistoryArchiveCheckpointProofRollupMigration.js';

jest.setTimeout(90_000);

describe('HistoryArchiveCheckpointProofRollupMigration', () => {
	let dataSource: DataSource;
	let postgres: DisposablePostgres;

	beforeAll(async () => {
		postgres = await startDisposablePostgres();
		dataSource = new DataSource({ type: 'postgres', url: postgres.url });
		await dataSource.initialize();
	});

	afterAll(async () => {
		if (dataSource?.isInitialized) await dataSource.destroy();
		if (postgres !== undefined) await postgres.stop();
	});

	beforeEach(async () => {
		await dataSource.query(
			'drop table if exists history_archive_checkpoint_proof'
		);
		await createProofTable();
	});

	afterEach(async () => {
		await runDown();
		await dataSource.query(
			'drop table if exists history_archive_checkpoint_proof'
		);
	});

	it('backfills, maintains exact deltas, and reruns without drift', async () => {
		await insertSmallFixture();
		await runUp();
		await expect(readRollups()).resolves.toEqual([
			expect.objectContaining({
				archiveUrlIdentity: 'archive-a',
				latestCheckpointLedger: 127,
				objectCompleteCheckpointProofs: '1',
				oldestCheckpointLedger: 63,
				pendingCheckpointProofs: '1',
				totalCheckpointProofs: '2',
				verifiedCheckpointProofs: '1'
			}),
			expect.objectContaining({
				archiveUrlIdentity: 'archive-b',
				mismatchCheckpointProofs: '1',
				totalCheckpointProofs: '1'
			})
		]);

		await dataSource.query(`
			insert into history_archive_checkpoint_proof
				("archiveUrlIdentity", "checkpointLedger", status,
					"requiredObjectsComplete")
			values ('archive-a', 191, 'not-evaluable', false)
		`);
		await dataSource.query(`
			update history_archive_checkpoint_proof
			set status = 'verified', "requiredObjectsComplete" = true
			where "archiveUrlIdentity" = 'archive-a'
				and "checkpointLedger" = 63
		`);
		await dataSource.query(`
			delete from history_archive_checkpoint_proof
			where "archiveUrlIdentity" = 'archive-b'
		`);

		const beforeRetry = await readRollups();
		await runUp();
		await expect(readRollups()).resolves.toEqual(beforeRetry);
		await expect(readProgress()).resolves.toMatchObject({ complete: true });
	});

	it('resumes committed batches after interruption and reconciles new writes', async () => {
		await insertScaleFixture(25_005);
		let batches = 0;
		const interrupted =
			new HistoryArchiveCheckpointProofRollupMigration1784830000000({
				afterInitialBatch: () => {
					batches++;
					if (batches === 1) throw new Error('simulated process interruption');
				}
			});

		await expect(runUp(interrupted)).rejects.toThrow(
			'simulated process interruption'
		);
		await expect(readProgress()).resolves.toMatchObject({
			complete: false,
			cutoffProofId: '25005',
			lastProofId: '10000'
		});
		await expect(readRollupTotal()).resolves.toBe(10_000);

		await dataSource.query(`
			insert into history_archive_checkpoint_proof
				("archiveUrlIdentity", "checkpointLedger", status,
					"requiredObjectsComplete")
			values ('archive-live', 63, 'verified', true)
		`);
		await runUp();

		await expect(readRollupTotal()).resolves.toBe(25_006);
		await expect(readProgress()).resolves.toMatchObject({
			complete: true,
			cutoffProofId: '25005',
			lastProofId: '25005'
		});
	});

	it('allows proof writes during a bounded batch and holds no table write lock', async () => {
		await insertScaleFixture(20_000);
		const entered = deferred<void>();
		const release = deferred<void>();
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		const [pidRow] = (await runner.query(
			'select pg_backend_pid()::int as pid'
		)) as readonly { readonly pid: number }[];
		const migration =
			new HistoryArchiveCheckpointProofRollupMigration1784830000000({
				beforeInitialBatchCommit: async () => {
					entered.resolve();
					await release.promise;
				}
			});
		const migrationPromise = migration.up(runner);

		try {
			await entered.promise;
			const lockModes = await readProofLockModes(pidRow?.pid ?? -1);
			expect(lockModes).toContain('AccessShareLock');
			expect(lockModes).not.toContain('ShareRowExclusiveLock');
			expect(lockModes).not.toContain('AccessExclusiveLock');

			const write = dataSource.query(`
				insert into history_archive_checkpoint_proof
					("archiveUrlIdentity", "checkpointLedger", status,
						"requiredObjectsComplete")
				values ('archive-concurrent', 63, 'pending', false)
			`);
			await expect(
				Promise.race([
					write.then(() => 'written' as const),
					delay(1_500).then(() => 'timed-out' as const)
				])
			).resolves.toBe('written');
		} finally {
			release.resolve();
			await migrationPromise;
			await runner.release();
		}

		await expect(readRollupTotal()).resolves.toBe(20_001);
	});

	it('removes every rollup artifact on down and remains rerunnable', async () => {
		await insertSmallFixture();
		await runUp();
		await runDown();
		await expect(readArtifacts()).resolves.toEqual([]);
		await expect(countProofs()).resolves.toBe(3);
		await runDown();
		await expect(readArtifacts()).resolves.toEqual([]);
	});

	async function createProofTable(): Promise<void> {
		await dataSource.query(`
			create table history_archive_checkpoint_proof (
				id bigserial primary key,
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				status text not null,
				"requiredObjectsComplete" boolean not null,
				unique ("archiveUrlIdentity", "checkpointLedger")
			)
		`);
		await dataSource.query(`
			create index checkpoint_proof_archive_status
			on history_archive_checkpoint_proof ("archiveUrlIdentity", status)
		`);
	}

	async function insertSmallFixture(): Promise<void> {
		await dataSource.query(`
			insert into history_archive_checkpoint_proof
				("archiveUrlIdentity", "checkpointLedger", status,
					"requiredObjectsComplete")
			values
				('archive-a', 63, 'pending', false),
				('archive-a', 127, 'verified', true),
				('archive-b', 63, 'mismatch', true)
		`);
	}

	async function insertScaleFixture(rows: number): Promise<void> {
		await dataSource.query(
			`
				insert into history_archive_checkpoint_proof (
					"archiveUrlIdentity", "checkpointLedger", status,
					"requiredObjectsComplete"
				)
				select 'archive-' || (value % 5)::text, value * 64 - 1,
					case value % 4
						when 0 then 'verified'
						when 1 then 'pending'
						when 2 then 'mismatch'
						else 'not-evaluable'
					end,
					value % 3 = 0
				from generate_series(1, $1::integer) value
			`,
			[rows]
		);
	}

	async function runUp(
		migration = new HistoryArchiveCheckpointProofRollupMigration1784830000000()
	): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		try {
			await migration.up(runner);
		} finally {
			await runner.release();
		}
	}

	async function runDown(): Promise<void> {
		const runner = dataSource.createQueryRunner();
		await runner.connect();
		try {
			await new HistoryArchiveCheckpointProofRollupMigration1784830000000().down(
				runner
			);
		} finally {
			await runner.release();
		}
	}

	async function readRollups(): Promise<readonly Record<string, unknown>[]> {
		return dataSource.query(`
			select "archiveUrlIdentity", "totalCheckpointProofs",
				"pendingCheckpointProofs", "verifiedCheckpointProofs",
				"mismatchCheckpointProofs", "notEvaluableCheckpointProofs",
				"objectCompleteCheckpointProofs", "oldestCheckpointLedger",
				"latestCheckpointLedger"
			from history_archive_checkpoint_proof_rollup
			order by "archiveUrlIdentity"
		`);
	}

	async function readProgress() {
		const [row] = (await dataSource.query(`
			select "complete", "cutoffProofId"::text as "cutoffProofId",
				"lastProofId"::text as "lastProofId"
			from history_archive_checkpoint_proof_rollup_progress
			where id = 1
		`)) as readonly Record<string, unknown>[];
		return row;
	}

	async function readRollupTotal(): Promise<number> {
		const [row] = (await dataSource.query(`
			select coalesce(sum("totalCheckpointProofs"), 0)::int as total
			from history_archive_checkpoint_proof_rollup
		`)) as readonly { readonly total: number }[];
		return row?.total ?? 0;
	}

	async function countProofs(): Promise<number> {
		const [row] = (await dataSource.query(`
			select count(*)::int as count from history_archive_checkpoint_proof
		`)) as readonly { readonly count: number }[];
		return row?.count ?? 0;
	}

	async function readProofLockModes(pid: number): Promise<readonly string[]> {
		const rows = (await dataSource.query(
			`
				select mode
				from pg_locks
				where pid = $1
					and relation = 'history_archive_checkpoint_proof'::regclass
					and granted
				order by mode
			`,
			[pid]
		)) as readonly { readonly mode: string }[];
		return rows.map((row) => row.mode);
	}

	async function readArtifacts(): Promise<readonly string[]> {
		const rows = (await dataSource.query(`
			select relname as artifact
			from pg_class
			where relname like 'history_archive_checkpoint_proof_rollup%'
			union all
			select proname
			from pg_proc
			where proname = 'refresh_history_archive_checkpoint_proof_rollup'
			union all
			select tgname
			from pg_trigger
			where tgname = 'trg_history_archive_checkpoint_proof_rollup'
			order by artifact
		`)) as readonly { readonly artifact: string }[];
		return rows.map((row) => row.artifact);
	}
});

function deferred<T>() {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
}

async function delay(milliseconds: number): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
