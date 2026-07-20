import { MigrationInterface, type QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_object_transition_priority';

export class HistoryArchiveTransitionPriorityIndexMigration1785240000000 implements MigrationInterface {
	name = 'HistoryArchiveTransitionPriorityIndexMigration1785240000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set lock_timeout = '2s'`);
		await queryRunner.query(`set statement_timeout = 0`);
		try {
			const state = await readIndexState(queryRunner);
			if (state.exists && !state.valid) {
				await queryRunner.query(
					`drop index concurrently if exists "${indexName}"`
				);
			}

			await queryRunner.query(`
				create index concurrently if not exists "${indexName}"
				on "history_archive_object_queue" (
					(case "executionReason"
						when 'canonical-frontier-reserve' then 0
						when 'proof-completion-reserve' then 1
						else 2
					end),
					"transitionEffectsRequiredAt",
					id
				)
				where "transitionEffectsRequiredAt" is not null
					and "transitionEffectsCompletedAt" is null
			`);
			await assertIndexValid(queryRunner);
		} finally {
			await queryRunner.query(`set statement_timeout = default`);
			await queryRunner.query(`set lock_timeout = default`);
		}
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}

async function assertIndexValid(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		do $migration$
		begin
			if not exists (
				select 1 from pg_index
				where indexrelid = to_regclass('${indexName}')
					and indisvalid and indisready
			) then
				raise exception 'transition priority index is absent or invalid';
			end if;
		end
		$migration$
	`);
}

async function readIndexState(
	queryRunner: QueryRunner
): Promise<{ readonly exists: boolean; readonly valid: boolean }> {
	const [row] = (await queryRunner.query(
		`
			select count(*) > 0 as "exists",
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
