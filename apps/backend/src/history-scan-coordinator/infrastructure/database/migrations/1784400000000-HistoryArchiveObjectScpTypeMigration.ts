import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectScpTypeMigration1784400000000 implements MigrationInterface {
	name = 'HistoryArchiveObjectScpTypeMigration1784400000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			drop constraint if exists "CHK_history_archive_object_queue_type"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			add constraint "CHK_history_archive_object_queue_type"
			check ("objectType" in (
				'history-archive-state',
				'checkpoint-state',
				'ledger',
				'transactions',
				'results',
				'scp',
				'bucket'
			))
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			drop constraint if exists "CHK_history_archive_object_queue_type"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			add constraint "CHK_history_archive_object_queue_type"
			check ("objectType" in (
				'history-archive-state',
				'checkpoint-state',
				'ledger',
				'transactions',
				'results',
				'bucket'
			))
		`);
	}
}
