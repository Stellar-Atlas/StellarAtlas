import type { MigrationInterface, QueryRunner } from 'typeorm';

const obsoletePendingClaimIndex =
	'idx_history_archive_object_pending_claim_priority';

export class HistoryArchiveWriteAmplificationMigration1785330000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveWriteAmplificationMigration1785330000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_queue" set (
				autovacuum_analyze_scale_factor = 0.001,
				autovacuum_analyze_threshold = 10000
			)
		`);
		await queryRunner.query(
			`drop index concurrently if exists "${obsoletePendingClaimIndex}"`
		);
		await queryRunner.query(`analyze "history_archive_object_queue"`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${obsoletePendingClaimIndex}"
			on "history_archive_object_queue" (
				(
					case
						when "objectType" = 'history-archive-state' then 0
						when "objectType" = 'bucket' then 1
						when "objectType" = 'checkpoint-state' then 2
						else 3
					end
				),
				(coalesce("checkpointLedger", -1)) desc,
				"objectOrder",
				"objectKey",
				"archiveUrlIdentity"
			)
			where status = 'pending'
		`);
		await queryRunner.query(`
			alter table "history_archive_object_queue" reset (
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			)
		`);
	}
}
