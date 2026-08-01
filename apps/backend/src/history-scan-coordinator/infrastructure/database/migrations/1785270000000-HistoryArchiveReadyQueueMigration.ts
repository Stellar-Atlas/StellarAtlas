import { MigrationInterface, type QueryRunner } from 'typeorm';

export class HistoryArchiveReadyQueueMigration1785270000000 implements MigrationInterface {
	name = 'HistoryArchiveReadyQueueMigration1785270000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_object_ready" (
				"objectRemoteId" uuid not null,
				"archiveUrlIdentity" text not null,
				priority smallint not null,
				"availableAt" timestamptz not null default now(),
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_ready"
					primary key ("objectRemoteId"),
				constraint "UQ_history_archive_object_ready_archive"
					unique ("archiveUrlIdentity"),
				constraint "FK_history_archive_object_ready_object"
					foreign key ("objectRemoteId")
					references "history_archive_object_queue" ("remoteId")
					on delete cascade,
				constraint "CHK_history_archive_object_ready_priority"
					check (priority between 0 and 2)
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_ready_claim"
			on "history_archive_object_ready" (
				priority, "availableAt", "objectRemoteId"
			)
		`);
		await queryRunner.query(`
			update "history_archive_object_claim_slot" slot
			set "objectRemoteId" = null,
				"claimedAt" = null,
				"updatedAt" = now()
			where slot."objectRemoteId" is not null
				and not exists (
					select 1
					from "history_archive_object_queue" object
					where object."remoteId" = slot."objectRemoteId"
				)
		`);
		await queryRunner.query(`
			do $migration$
			begin
				if not exists (
					select 1 from pg_constraint
					where conname = 'FK_history_archive_object_claim_slot_object'
				) then
					alter table "history_archive_object_claim_slot"
						add constraint "FK_history_archive_object_claim_slot_object"
						foreign key ("objectRemoteId")
						references "history_archive_object_queue" ("remoteId")
						on delete set null
						not valid;
				end if;
			end
			$migration$
		`);
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
			validate constraint "FK_history_archive_object_claim_slot_object"
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
			drop constraint if exists "FK_history_archive_object_claim_slot_object"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_object_ready"
		`);
	}
}
