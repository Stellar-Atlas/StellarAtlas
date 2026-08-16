import type { MigrationInterface, QueryRunner } from 'typeorm';

const legacyArchiveConstraint = 'UQ_history_archive_object_ready_archive';
const priorityLaneIndex = 'history_archive_object_ready_archive_priority_key';

export class HistoryArchiveReadyPriorityLaneMigration1785460000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveReadyPriorityLaneMigration1785460000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2min'`);
		await queryRunner.query(`set statement_timeout = 0`);
		try {
			await removeInvalidIndex(queryRunner, priorityLaneIndex);
			await queryRunner.query(`
				create unique index concurrently if not exists
					"${priorityLaneIndex}"
				on "history_archive_object_ready" (
					"archiveUrlIdentity", priority
				)
			`);
			await assertIndexValid(queryRunner, priorityLaneIndex);
			await queryRunner.query(`
				alter table "history_archive_object_ready"
				drop constraint if exists "${legacyArchiveConstraint}"
			`);
		} finally {
			await queryRunner.query(`set statement_timeout = default`);
			await queryRunner.query(`set lock_timeout = default`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2min'`);
		await queryRunner.query(`set statement_timeout = 0`);
		try {
			await queryRunner.query(`
				do $migration$
				begin
					if exists (
						select 1
						from "history_archive_object_ready"
						group by "archiveUrlIdentity"
						having count(*) > 1
					) then
						raise exception
							'cannot collapse active history archive priority lanes safely';
					end if;
					if not exists (
						select 1 from pg_constraint
						where conname = '${legacyArchiveConstraint}'
							and conrelid =
								'history_archive_object_ready'::regclass
					) then
						alter table "history_archive_object_ready"
						add constraint "${legacyArchiveConstraint}"
						unique ("archiveUrlIdentity");
					end if;
				end
				$migration$
			`);
			await queryRunner.query(
				`drop index concurrently if exists "${priorityLaneIndex}"`
			);
		} finally {
			await queryRunner.query(`set statement_timeout = default`);
			await queryRunner.query(`set lock_timeout = default`);
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
	await queryRunner.query(`
		do $migration$
		begin
			if not exists (
				select 1 from pg_index
				where indexrelid = to_regclass('${indexName}')
					and indisvalid and indisready
			) then
				raise exception
					'history archive priority lane index ${indexName} is absent or invalid';
			end if;
		end
		$migration$
	`);
}
