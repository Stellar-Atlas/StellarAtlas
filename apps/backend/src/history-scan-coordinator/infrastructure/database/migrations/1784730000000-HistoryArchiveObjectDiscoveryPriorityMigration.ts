import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectDiscoveryPriorityMigration1784730000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectDiscoveryPriorityMigration1784730000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_object_discovery_claim_priority"
			on "history_archive_object_queue" (
				(
					case
						when "objectType" = 'history-archive-state' then 0
						when "objectType" = 'checkpoint-state' then 1
						when "objectType" in (
							'ledger',
							'transactions',
							'results',
							'scp'
						) then 2
						when "objectType" = 'bucket' then 3
						else 4
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
			create index if not exists
				"idx_history_archive_object_checkpoint_refresh"
			on "history_archive_object_queue" (
				"archiveUrlIdentity",
				"checkpointLedger",
				"objectType",
				status
			)
			where "checkpointLedger" is not null
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists
				"idx_history_archive_object_checkpoint_refresh"
		`);
		await queryRunner.query(`
			drop index if exists
				"idx_history_archive_object_discovery_claim_priority"
		`);
	}
}
