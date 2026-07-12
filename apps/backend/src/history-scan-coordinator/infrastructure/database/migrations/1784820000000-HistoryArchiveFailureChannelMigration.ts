import { MigrationInterface, type QueryRunner } from 'typeorm';

export const failureChannelMigrationLockTimeoutMs = 2_000;
export const failureChannelMigrationStatementTimeoutMs = 10_000;

const migrationLockSql =
	'select pg_try_advisory_lock(1784820000, 1) as acquired';
const migrationUnlockSql = 'select pg_advisory_unlock(1784820000, 1)';

export class HistoryArchiveFailureChannelMigration1784820000000 implements MigrationInterface {
	name = 'HistoryArchiveFailureChannelMigration1784820000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await withMigrationGuard(queryRunner, async () => {
			await queryRunner.query(`
				alter table "history_archive_object_queue"
					add column if not exists "failureChannel" text
			`);
			await queryRunner.query(`
				alter table "history_archive_object_event"
					add column if not exists "failureChannel" text
			`);
			await addConstraintIfMissing(
				queryRunner,
				'history_archive_object_queue',
				'chk_history_archive_object_failure_channel'
			);
			await addConstraintIfMissing(
				queryRunner,
				'history_archive_object_event',
				'chk_history_archive_event_failure_channel'
			);
		});
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await withMigrationGuard(queryRunner, async () => {
			await queryRunner.query(`
				alter table "history_archive_object_event"
					drop constraint if exists
						"chk_history_archive_event_failure_channel"
			`);
			await queryRunner.query(`
				alter table "history_archive_object_event"
					drop column if exists "failureChannel"
			`);
			await queryRunner.query(`
				alter table "history_archive_object_queue"
					drop constraint if exists
						"chk_history_archive_object_failure_channel"
			`);
			await queryRunner.query(`
				alter table "history_archive_object_queue"
					drop column if exists "failureChannel"
			`);
		});
	}
}

async function addConstraintIfMissing(
	queryRunner: QueryRunner,
	tableName: string,
	constraintName: string
): Promise<void> {
	await queryRunner.query(`
		do $migration$
		begin
			if not exists (
				select 1
				from pg_constraint constraint_row
				join pg_class table_row
					on table_row.oid = constraint_row.conrelid
				join pg_namespace namespace_row
					on namespace_row.oid = table_row.relnamespace
				where namespace_row.nspname = current_schema()
					and table_row.relname = '${tableName}'
					and constraint_row.conname = '${constraintName}'
			) then
				alter table "${tableName}"
					add constraint "${constraintName}"
					check (
						"failureChannel" is null
						or "failureChannel" in ('archive_evidence', 'scanner_issue')
					) not valid;
			end if;
		end
		$migration$;
	`);
}

async function withMigrationGuard(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	if (queryRunner.isTransactionActive) {
		throw new Error('Failure-channel migration requires transaction mode none');
	}
	const [lock] = (await queryRunner.query(migrationLockSql)) as readonly {
		readonly acquired?: boolean;
	}[];
	if (lock?.acquired !== true) {
		throw new Error('Failure-channel migration is already running');
	}

	try {
		await queryRunner.query(
			`set lock_timeout = '${failureChannelMigrationLockTimeoutMs}ms'`
		);
		await queryRunner.query(
			`set statement_timeout = '${failureChannelMigrationStatementTimeoutMs}ms'`
		);
		await operation();
	} finally {
		try {
			await queryRunner.query('reset lock_timeout');
			await queryRunner.query('reset statement_timeout');
		} finally {
			await queryRunner.query(migrationUnlockSql);
		}
	}
}
