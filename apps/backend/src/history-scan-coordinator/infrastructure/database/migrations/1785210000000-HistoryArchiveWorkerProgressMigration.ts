import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveWorkerProgressMigration1785210000000 implements MigrationInterface {
	name = 'HistoryArchiveWorkerProgressMigration1785210000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_worker_status"
				add column if not exists "slotIndex" smallint,
				add column if not exists "bytesTotal" bigint
		`);
		await queryRunner.query(`
			update "history_archive_worker_status"
			set "slotIndex" = case
				when substring("workerId" from '-([0-9]+)-[0-9]+$')::numeric
					between 0 and 23
				then substring("workerId" from '-([0-9]+)-[0-9]+$')::smallint
				else 0
			end
			where "slotIndex" is null
		`);
		await queryRunner.query(`
			alter table "history_archive_worker_status"
				alter column "slotIndex" set not null,
				drop constraint if exists "CHK_history_archive_worker_status_slot",
				add constraint "CHK_history_archive_worker_status_slot"
					check ("slotIndex" between 0 and 23),
				drop constraint if exists "CHK_history_archive_worker_status_total_bytes",
				add constraint "CHK_history_archive_worker_status_total_bytes"
					check ("bytesTotal" is null or "bytesTotal" >= 0),
				drop constraint if exists "CHK_history_archive_worker_status_total_activity",
				add constraint "CHK_history_archive_worker_status_total_activity"
					check ("bytesTotal" is null or "stageCode" > 0)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_worker_status"
				drop constraint if exists "CHK_history_archive_worker_status_total_activity",
				drop constraint if exists "CHK_history_archive_worker_status_total_bytes",
				drop constraint if exists "CHK_history_archive_worker_status_slot",
				drop column if exists "bytesTotal",
				drop column if exists "slotIndex"
		`);
	}
}
