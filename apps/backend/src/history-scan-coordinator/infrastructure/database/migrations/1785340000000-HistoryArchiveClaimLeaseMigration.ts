import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveClaimLeaseMigration1785340000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveClaimLeaseMigration1785340000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				add column if not exists "claimAttempt" integer
		`);
		await queryRunner.query(`
			update "history_archive_object_claim_slot" slot
			set "claimAttempt" = object.attempts
			from "history_archive_object_queue" object
			where object."remoteId" = slot."objectRemoteId"
				and object.status = 'scanning'
				and slot."claimAttempt" is null
		`);
		await queryRunner.query(`
			update "history_archive_object_claim_slot"
			set "objectRemoteId" = null,
				"claimAttempt" = null,
				"claimedAt" = null,
				"updatedAt" = now()
			where "objectRemoteId" is not null and "claimAttempt" is null
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				drop constraint if exists
					"CHK_history_archive_object_claim_slot_attempt"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				add constraint "CHK_history_archive_object_claim_slot_attempt"
				check (
					("objectRemoteId" is null and "claimAttempt" is null)
					or ("objectRemoteId" is not null and "claimAttempt" > 0)
				) not valid
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				validate constraint "CHK_history_archive_object_claim_slot_attempt"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot" set (
				fillfactor = 70,
				autovacuum_vacuum_scale_factor = 0,
				autovacuum_vacuum_threshold = 1000,
				autovacuum_analyze_scale_factor = 0,
				autovacuum_analyze_threshold = 1000
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				drop constraint if exists
					"CHK_history_archive_object_claim_slot_attempt",
				drop column if exists "claimAttempt"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot" reset (
				fillfactor,
				autovacuum_vacuum_scale_factor,
				autovacuum_vacuum_threshold,
				autovacuum_analyze_scale_factor,
				autovacuum_analyze_threshold
			)
		`);
	}
}
