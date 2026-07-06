import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectEventMigration1784370000000
	implements MigrationInterface
{
	name = 'HistoryArchiveObjectEventMigration1784370000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_object_event" (
				"id" serial not null,
				"remoteId" uuid not null default gen_random_uuid(),
				"objectRemoteId" uuid not null,
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"objectType" text not null,
				"objectKey" text not null,
				"objectUrl" text not null,
				"eventType" text not null,
				"evidenceClass" text,
				"workerStage" text,
				"checkpointLedger" integer,
				"bucketHash" text,
				"bytesDownloaded" bigint,
				"claimAttempt" integer,
				"errorType" text,
				"errorMessage" text,
				"httpStatus" integer,
				"nextAttemptAt" timestamptz,
				"verificationFacts" jsonb,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_event"
					primary key ("id"),
				constraint "UQ_history_archive_object_event_remote"
					unique ("remoteId"),
				constraint "CHK_history_archive_object_event_type"
					check ("eventType" in (
						'claimed',
						'heartbeat',
						'verified',
						'failed',
						'released'
					)),
				constraint "CHK_history_archive_object_event_evidence"
					check (
						"evidenceClass" is null
						or "evidenceClass" in (
							'archive-object',
							'worker-infrastructure',
							'coordinator-infrastructure'
						)
					)
			)
		`);
		await queryRunner.query(`
			create unique index if not exists
				"idx_history_archive_object_event_remote_unique"
			on "history_archive_object_event" ("remoteId")
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_event_remote"
			on "history_archive_object_event" ("objectRemoteId", "createdAt" desc)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_event_archive"
			on "history_archive_object_event" (
				"archiveUrlIdentity",
				"createdAt" desc
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_object_event_type"
			on "history_archive_object_event" ("eventType", "createdAt" desc)
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_object_event"
		`);
	}
}
