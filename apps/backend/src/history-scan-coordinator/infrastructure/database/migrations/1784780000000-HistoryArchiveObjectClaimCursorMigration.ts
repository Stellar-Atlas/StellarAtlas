import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveObjectClaimCursorMigration1784780000000 implements MigrationInterface {
	name = 'HistoryArchiveObjectClaimCursorMigration1784780000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			set local lock_timeout = '2s';
			set local statement_timeout = '30s'
		`);
		await queryRunner.query(`
				alter table "history_archive_object_queue"
					add column if not exists "lastClaimedAt" timestamptz,
					add column if not exists "dependencyReady" boolean,
					add column if not exists "executionDisposition" text,
					add column if not exists "executionReason" text,
					add column if not exists "executionDispositionAt" timestamptz,
					add column if not exists "dependenciesMaterializedAt" timestamptz,
					add column if not exists "completionArchiveMetadata" jsonb,
					add column if not exists "transitionEffectsCompletedAt" timestamptz,
					add column if not exists "transitionEffectsRequiredAt" timestamptz
			`);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
				alter column "executionDisposition" set default 'deferred',
				alter column "executionReason" set default 'legacy-planning-intent'
		`);
		await queryRunner.query(`
			alter table "history_archive_object_host_throttle"
			add column if not exists "retryAfterUntil" timestamptz
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_object_claim_slot" (
				"slot" smallint not null,
				"objectRemoteId" uuid,
				"claimedAt" timestamptz,
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_claim_slot" primary key ("slot"),
				constraint "UQ_history_archive_object_claim_slot_object"
					unique ("objectRemoteId"),
				constraint "CHK_history_archive_object_claim_slot_range"
					check ("slot" >= 0 and "slot" < 24)
			)
		`);
		await queryRunner.query(`
			insert into "history_archive_object_claim_slot" ("slot")
			select generate_series(0, 23)::smallint
			on conflict ("slot") do nothing
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_object_plan" (
				"id" bigserial not null,
				"remoteId" uuid not null,
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"hostIdentity" text not null,
				"objectType" text not null,
				"objectKey" text not null,
				"objectOrder" integer not null,
				"objectUrl" text not null,
				"status" text not null,
				"checkpointLedger" integer,
				"bucketHash" text,
				"dependencyReady" boolean not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_plan" primary key ("id"),
				constraint "UQ_history_archive_object_plan_identity"
					unique ("archiveUrlIdentity", "objectType", "objectKey")
			)
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_bucket_dependency" (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"bucketHash" text not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_bucket_dependency"
					primary key (
						"archiveUrlIdentity",
						"checkpointLedger",
						"bucketHash"
					)
				)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_checkpoint_bucket_reverse"
			on "history_archive_checkpoint_bucket_dependency" (
				"archiveUrlIdentity", "bucketHash", "checkpointLedger"
			)
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_object_frontier_cursor" (
				"archiveUrlIdentity" text not null,
				"objectType" text not null,
				"objectKey" text,
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_object_frontier_cursor"
					primary key ("archiveUrlIdentity", "objectType")
			)
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_reconciliation_state" (
				"name" text not null,
				"admittedRows" bigint not null default 0,
				"lastAnalyzedAt" timestamptz,
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_reconciliation_state"
					primary key ("name")
			)
		`);
		await queryRunner.query(`
			insert into "history_archive_reconciliation_state" ("name")
			values ('execution-disposition')
			on conflict ("name") do nothing
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_reconciliation_state"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_object_frontier_cursor"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_bucket_dependency"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_object_plan"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_object_claim_slot"
		`);
		await queryRunner.query(`
			alter table "history_archive_object_host_throttle"
			drop column if exists "retryAfterUntil"
		`);
		await queryRunner.query(`
				alter table "history_archive_object_queue"
					drop column if exists "transitionEffectsRequiredAt",
					drop column if exists "transitionEffectsCompletedAt",
				drop column if exists "completionArchiveMetadata",
				drop column if exists "dependenciesMaterializedAt",
				drop column if exists "executionDispositionAt",
				drop column if exists "executionReason",
				drop column if exists "executionDisposition",
				drop column if exists "dependencyReady",
				drop column if exists "lastClaimedAt"
		`);
	}
}
