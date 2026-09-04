import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveSharedBucketSetShadowMigration1788494000000 implements MigrationInterface {
	name = 'HistoryArchiveSharedBucketSetShadowMigration1788494000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_bucket_set" (
				"bucketSetDigest" text not null,
				"bucketCount" integer not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_bucket_set"
					primary key ("bucketSetDigest"),
				constraint "CHK_history_archive_checkpoint_bucket_set_digest"
					check ("bucketSetDigest" ~ '^[0-9a-f]{64}$'),
				constraint "CHK_history_archive_checkpoint_bucket_set_count"
					check ("bucketCount" > 0)
			)
		`);
		await queryRunner.query(`
			create table if not exists
				"history_archive_checkpoint_bucket_set_member" (
				"bucketSetDigest" text not null,
				"bucketHash" text not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_bucket_set_member"
					primary key ("bucketSetDigest", "bucketHash"),
				constraint "FK_history_archive_checkpoint_bucket_set_member_set"
					foreign key ("bucketSetDigest")
					references "history_archive_checkpoint_bucket_set" (
						"bucketSetDigest"
					)
					on delete cascade,
				constraint "CHK_history_archive_checkpoint_bucket_member_hash"
					check ("bucketHash" ~ '^[0-9a-f]{64}$')
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_checkpoint_bucket_member_reverse"
			on "history_archive_checkpoint_bucket_set_member" (
				"bucketHash", "bucketSetDigest"
			)
		`);
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_content" (
				"contentDigest" text not null,
				"checkpointLedger" integer not null,
				"bucketListHash" text not null,
				"bucketSetDigest" text not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_content"
					primary key ("contentDigest"),
				constraint "FK_history_archive_checkpoint_content_bucket_set"
					foreign key ("bucketSetDigest")
					references "history_archive_checkpoint_bucket_set" (
						"bucketSetDigest"
					)
					on delete restrict,
				constraint "CHK_history_archive_checkpoint_content_digest"
					check ("contentDigest" ~ '^[0-9a-f]{64}$'),
				constraint "CHK_history_archive_checkpoint_content_ledger"
					check ("checkpointLedger" >= 0),
				constraint "CHK_history_archive_checkpoint_content_bucket_hash"
					check (length("bucketListHash") > 0)
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_checkpoint_content_bucket_set"
			on "history_archive_checkpoint_content" (
				"bucketSetDigest", "bucketListHash", "checkpointLedger"
			)
		`);
		await queryRunner.query(`
			create table if not exists
				"history_archive_checkpoint_content_observation" (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"contentDigest" text not null,
				"checkpointStateObjectRemoteId" uuid not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_content_observation"
					primary key ("archiveUrlIdentity", "checkpointLedger"),
				constraint "FK_history_archive_checkpoint_observation_content"
					foreign key ("contentDigest")
					references "history_archive_checkpoint_content" (
						"contentDigest"
					)
					on delete restrict,
				constraint "UQ_history_archive_checkpoint_observation_object"
					unique ("checkpointStateObjectRemoteId"),
				constraint "CHK_history_archive_checkpoint_observation_ledger"
					check ("checkpointLedger" >= 0)
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"idx_history_archive_checkpoint_observation_content"
			on "history_archive_checkpoint_content_observation" (
				"contentDigest", "archiveUrlIdentity", "checkpointLedger"
			)
		`);
		await queryRunner.query(`
			create table if not exists
				"history_archive_checkpoint_content_conflict" (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"checkpointStateObjectRemoteId" uuid not null,
				"observedContentDigest" text not null,
				"observedBucketListHash" text not null,
				"observedBucketSetDigest" text not null,
				"observedBucketCount" integer not null,
				"storedContentDigest" text,
				"storedBucketListHash" text,
				"storedBucketSetDigest" text,
				"storedBucketCount" integer,
				"observedAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_content_conflict"
					primary key ("archiveUrlIdentity", "checkpointLedger")
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_content_conflict"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_content_observation"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_content"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_bucket_set_member"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_bucket_set"
		`);
	}
}
