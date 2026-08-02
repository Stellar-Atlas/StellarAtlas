import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveWorkerDownloadWaitStageMigration1785300000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveWorkerDownloadWaitStageMigration1785300000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_worker_status"
				drop constraint if exists "CHK_history_archive_worker_status_stage",
				add constraint "CHK_history_archive_worker_status_stage"
					check ("stageCode" between 0 and 21)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_worker_status"
				drop constraint if exists "CHK_history_archive_worker_status_stage",
				add constraint "CHK_history_archive_worker_status_stage"
					check ("stageCode" between 0 and 20)
		`);
	}
}
