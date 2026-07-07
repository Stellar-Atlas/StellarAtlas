import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectClaimPriorityMigration1784700000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectClaimPriorityMigration1784700000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_object_pending_claim_priority"
			on "history_archive_object_queue" (
				(
					case
						when "objectType" = 'history-archive-state' then 0
						when "objectType" = 'checkpoint-state' then 2
						else 1
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
			drop index if exists
				"idx_history_archive_object_pending_claim_priority"
		`);
	}
}
