import { MigrationInterface, type QueryRunner } from 'typeorm';

const indexDefinitions = [
	{
		createSql: `
			create index concurrently if not exists
				"idx_history_archive_object_dependency_reconcile"
			on "history_archive_object_queue" (id)
			include (
				"archiveUrlIdentity", "objectType", "checkpointLedger", "bucketHash"
			)
			where status = 'pending'
				and "executionDisposition" = 'executable'
				and "dependencyReady" is null
		`,
		name: 'idx_history_archive_object_dependency_reconcile'
	},
	{
		createSql: `
				create index concurrently if not exists
					"idx_history_archive_object_plan_root_created"
			on "history_archive_object_plan" (
				"archiveUrlIdentity", "createdAt", id
			)
		`,
		name: 'idx_history_archive_object_plan_root_created'
	}
] as const;

export class HistoryArchiveReadyQueueIndexesMigration1785280000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveReadyQueueIndexesMigration1785280000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2min'`);
		await queryRunner.query(`set statement_timeout = 0`);
		try {
			for (const definition of indexDefinitions) {
				await removeInvalidIndex(queryRunner, definition.name);
				await queryRunner.query(definition.createSql);
				await assertIndexValid(queryRunner, definition.name);
			}
			await queryRunner.query(`analyze "history_archive_object_plan"`);
		} finally {
			await queryRunner.query(`set statement_timeout = default`);
			await queryRunner.query(`set lock_timeout = default`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		for (const definition of [...indexDefinitions].reverse()) {
			await queryRunner.query(
				`drop index concurrently if exists "${definition.name}"`
			);
		}
	}
}

async function removeInvalidIndex(
	queryRunner: QueryRunner,
	indexName: string
): Promise<void> {
	const [state] = (await queryRunner.query(
		`
			select index_state.indisvalid and index_state.indisready as valid
			from pg_class index_relation
			join pg_namespace namespace
				on namespace.oid = index_relation.relnamespace
			join pg_index index_state
				on index_state.indexrelid = index_relation.oid
			where namespace.nspname = current_schema()
				and index_relation.relname = $1
		`,
		[indexName]
	)) as readonly { readonly valid?: boolean }[];
	if (state !== undefined && state.valid !== true) {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}

async function assertIndexValid(
	queryRunner: QueryRunner,
	indexName: string
): Promise<void> {
	await queryRunner.query(
		`
			do $migration$
			begin
				if not exists (
					select 1 from pg_index
					where indexrelid = to_regclass('${indexName}')
						and indisvalid and indisready
				) then
					raise exception 'archive scheduler index ${indexName} is absent or invalid';
				end if;
			end
			$migration$
		`
	);
}
