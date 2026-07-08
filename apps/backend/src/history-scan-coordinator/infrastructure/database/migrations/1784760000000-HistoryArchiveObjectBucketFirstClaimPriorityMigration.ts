import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectBucketFirstClaimPriorityMigration1784760000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectBucketFirstClaimPriorityMigration1784760000000';
	transaction = false;

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index concurrently if exists
				"idx_history_archive_object_pending_claim_priority"
		`);
		await queryRunner.query(`
			create index concurrently if not exists
				"idx_history_archive_object_pending_claim_priority"
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
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index concurrently if exists
				"idx_history_archive_object_pending_claim_priority"
		`);
		await queryRunner.query(`
			create index concurrently if not exists
				"idx_history_archive_object_pending_claim_priority"
			on "history_archive_object_queue" (
				(
					case
						when "objectType" = 'history-archive-state' then 0
						when "objectType" = 'checkpoint-state' then 1
						when "objectType" = 'bucket' then 2
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
	}
}
