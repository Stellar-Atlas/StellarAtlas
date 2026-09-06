import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveRemoteFailureContinuationMigration1788601000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveRemoteFailureContinuationMigration1788601000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		// NOT VALID avoids scanning historical evidence; the old constraint already
		// guaranteed the old value. New writes are checked immediately.
		await queryRunner.query(`
   alter table "history_archive_checkpoint_substitution"
    drop constraint "CK_history_archive_checkpoint_substitution_reason",
    add constraint "CK_history_archive_checkpoint_substitution_reason"
     check (reason in ('remote-http-missing', 'remote-source-failure')) not valid
  `);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		// Refuse rollback if new evidence exists; never relabel a timeout as missing.
		await queryRunner.query(`
   alter table "history_archive_checkpoint_substitution"
    drop constraint "CK_history_archive_checkpoint_substitution_reason",
    add constraint "CK_history_archive_checkpoint_substitution_reason"
     check (reason = 'remote-http-missing')
  `);
	}
}
