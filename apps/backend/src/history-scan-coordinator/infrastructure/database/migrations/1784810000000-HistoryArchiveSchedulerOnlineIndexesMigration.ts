import { MigrationInterface, type QueryRunner } from 'typeorm';
import { statfs } from 'node:fs/promises';

type IndexDefinition = {
	readonly createSql: string;
	readonly name: string;
};

// The live predicates exclude the 30M-row legacy NULL/deferred backlog. The
// expected final footprint is below 64 MiB and concurrent-build peak below
// 256 MiB while the scheduler watermark caps executable rows.
export const schedulerOnlineIndexDiskEstimate = {
	estimatedFinalBytes: 64n * 1024n * 1024n,
	estimatedPeakBytes: 256n * 1024n * 1024n
};
const schedulerMigrationSafetyBytes = 1024n * 1024n * 1024n;

const indexDefinitions: readonly IndexDefinition[] = [
	{
		name: 'idx_history_archive_object_executable_claim',
		createSql: `
				create index concurrently if not exists
					"idx_history_archive_object_executable_claim"
				on "history_archive_object_queue" (
					"archiveUrlIdentity",
					status,
					"nextAttemptAt",
					"lastClaimedAt" asc nulls first,
					"objectOrder",
					"checkpointLedger" desc,
					"objectKey",
					id
				)
				include ("hostIdentity")
				where "executionDisposition" = 'executable'
					and "dependencyReady" = true
					and status in ('pending', 'failed')
			`
	},
	{
		name: 'idx_history_archive_object_transition_reconcile',
		createSql: `
				create index concurrently if not exists
					"idx_history_archive_object_transition_reconcile"
				on "history_archive_object_queue" (
					"transitionEffectsRequiredAt", id
				)
				where "transitionEffectsRequiredAt" is not null
					and "transitionEffectsCompletedAt" is null
			`
	}
];

export class HistoryArchiveSchedulerOnlineIndexesMigration1784810000000 implements MigrationInterface {
	name = 'HistoryArchiveSchedulerOnlineIndexesMigration1784810000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await assertSchedulerMigrationDiskCapacity();
		await queryRunner.query(`set lock_timeout = '2s'`);
		try {
			for (const definition of indexDefinitions) {
				await ensureValidConcurrentIndex(queryRunner, definition);
			}
			await queryRunner.query(`
				analyze (skip_locked)
				"history_archive_object_queue" (
					status,
					"executionDisposition",
					"dependencyReady",
					"nextAttemptAt",
					"archiveUrlIdentity",
					"lastClaimedAt"
				)
				`);
			await queryRunner.query(`
					update "history_archive_reconciliation_state"
					set "lastAnalyzedAt" = now(), "updatedAt" = now()
					where name = 'execution-disposition'
				`);
		} finally {
			await queryRunner.query(`set lock_timeout = default`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const index of [
			'idx_history_archive_object_transition_reconcile',
			'idx_history_archive_object_executable_claim'
		]) {
			await queryRunner.query(`drop index concurrently if exists "${index}"`);
		}
	}
}

async function assertSchedulerMigrationDiskCapacity(): Promise<void> {
	const requiredBytes =
		schedulerOnlineIndexDiskEstimate.estimatedPeakBytes +
		schedulerMigrationSafetyBytes;
	const dataPath =
		process.env.HISTORY_ARCHIVE_SCHEDULER_MIGRATION_DATA_PATH ??
		'/home/observe/stellarbeat-data';
	const paths = [...new Set(['/', dataPath])];
	for (const path of paths) {
		let stats: Awaited<ReturnType<typeof statfs>>;
		try {
			stats = await statfs(path);
		} catch (error) {
			throw new Error(
				`Archive scheduler migration cannot verify free disk at ${path}: ${String(error)}`
			);
		}
		const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
		if (availableBytes < requiredBytes) {
			throw new Error(
				`Archive scheduler migration requires ${requiredBytes} free bytes at ${path}; found ${availableBytes}`
			);
		}
	}
}

async function ensureValidConcurrentIndex(
	queryRunner: QueryRunner,
	definition: IndexDefinition
): Promise<void> {
	const before = await readIndexState(queryRunner, definition.name);
	if (before.exists && !before.valid) {
		await queryRunner.query(
			`drop index concurrently if exists "${definition.name}"`
		);
	}

	await queryRunner.query(definition.createSql);
	await assertIndexValid(queryRunner, definition.name);
}

async function assertIndexValid(
	queryRunner: QueryRunner,
	indexName: string
): Promise<void> {
	await queryRunner.query(`
		do $migration$
		begin
			if not exists (
				select 1
				from pg_index
				where indexrelid = to_regclass('"${indexName}"')
					and indisvalid
					and indisready
			) then
				raise exception 'scheduler index ${indexName} is absent or invalid';
			end if;
		end
		$migration$
	`);
}

async function readIndexState(
	queryRunner: QueryRunner,
	indexName: string
): Promise<{ readonly exists: boolean; readonly valid: boolean }> {
	const [row] = (await queryRunner.query(
		`
			select
				count(*) > 0 as "exists",
				coalesce(bool_and(index_state.indisvalid), false) as valid
			from pg_class index_relation
			join pg_namespace namespace
				on namespace.oid = index_relation.relnamespace
			left join pg_index index_state
				on index_state.indexrelid = index_relation.oid
			where namespace.nspname = current_schema()
				and index_relation.relkind = 'i'
				and index_relation.relname = $1
		`,
		[indexName]
	)) as readonly { readonly exists?: boolean; readonly valid?: boolean }[];

	return { exists: row?.exists === true, valid: row?.valid === true };
}
