import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveSharedCheckpointBackfillMigration1788495000000 implements MigrationInterface {
	name = 'HistoryArchiveSharedCheckpointBackfillMigration1788495000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists
				"history_archive_shared_checkpoint_backfill_progress" (
				"name" text not null,
				"lastQueueId" bigint not null default 0,
				"scannedRows" bigint not null default 0,
				"eligibleRows" bigint not null default 0,
				"materializedRows" bigint not null default 0,
				"startedAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				"completedAt" timestamptz,
				constraint "PK_history_archive_shared_checkpoint_backfill"
					primary key ("name"),
				constraint "CHK_history_archive_shared_checkpoint_cursor"
					check ("lastQueueId" >= 0),
				constraint "CHK_history_archive_shared_checkpoint_counts"
					check (
						"scannedRows" >= 0
						and "eligibleRows" >= 0
						and "materializedRows" >= 0
					)
			)
		`);
		await queryRunner.query(`
			insert into "history_archive_shared_checkpoint_backfill_progress" (
				"name"
			)
			values ('shared-checkpoint-content-v1')
			on conflict ("name") do nothing
		`);
		await queryRunner.query(`
			create or replace view
				"history_archive_checkpoint_bucket_dependency_shared"
			as
			select observation."archiveUrlIdentity",
				observation."checkpointLedger",
				observation."checkpointStateObjectRemoteId",
				observation."contentDigest",
				content."bucketListHash",
				content."bucketSetDigest",
				member."bucketHash"
			from "history_archive_checkpoint_content_observation" observation
			join "history_archive_checkpoint_content" content
				on content."contentDigest" = observation."contentDigest"
			join "history_archive_checkpoint_bucket_set_member" member
				on member."bucketSetDigest" = content."bucketSetDigest"
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop view if exists
				"history_archive_checkpoint_bucket_dependency_shared"
		`);
		await queryRunner.query(`
			drop table if exists
				"history_archive_shared_checkpoint_backfill_progress"
		`);
	}
}
