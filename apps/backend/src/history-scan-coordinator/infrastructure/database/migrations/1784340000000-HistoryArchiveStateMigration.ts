import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveStateMigration1784340000000
	implements MigrationInterface
{
	name = 'HistoryArchiveStateMigration1784340000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_state_snapshot" (
				"id" serial not null,
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"stateUrl" text not null,
				"status" text not null,
				"observedAt" timestamptz not null,
				"source" text not null,
				"version" integer,
				"server" text,
				"currentLedger" integer,
				"networkPassphrase" text,
				"currentBuckets" jsonb,
				"hotArchiveBuckets" jsonb,
				"rawState" jsonb,
				"errorType" text,
				"errorMessage" text,
				"httpStatus" integer,
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_state_snapshot"
					primary key ("id"),
				constraint "UQ_history_archive_state_snapshot_identity"
					unique ("archiveUrlIdentity"),
				constraint "CHK_history_archive_state_snapshot_status"
					check ("status" in ('available', 'invalid', 'unreachable')),
				constraint "CHK_history_archive_state_snapshot_source"
					check ("source" in ('backfill', 'history-scanner', 'network-scan'))
			)
		`);
		await queryRunner.query(`
			create index if not exists "IDX_history_archive_state_snapshot_url"
			on "history_archive_state_snapshot" ("archiveUrl")
		`);
		await queryRunner.query(`
			create index if not exists "IDX_history_archive_state_snapshot_status"
			on "history_archive_state_snapshot" ("status")
		`);
		await queryRunner.query(`
			create index if not exists "IDX_history_archive_state_snapshot_observed"
			on "history_archive_state_snapshot" ("observedAt")
		`);
		await queryRunner.query(`
			insert into "history_archive_state_snapshot" (
				"archiveUrl",
				"archiveUrlIdentity",
				"stateUrl",
				"status",
				"observedAt",
				"source",
				"version",
				"server",
				"currentLedger",
				"networkPassphrase",
				"currentBuckets",
				"hotArchiveBuckets",
				"rawState",
				"createdAt",
				"updatedAt"
			)
			select distinct on (
				lower(regexp_replace(scan.url, '/+$', ''))
			)
				regexp_replace(scan.url, '/+$', '') as "archiveUrl",
				lower(regexp_replace(scan.url, '/+$', '')) as "archiveUrlIdentity",
				scan."archiveMetadata"->>'stellarHistoryUrl' as "stateUrl",
				'available' as "status",
				coalesce(
					nullif(scan."archiveMetadata"->>'observedAt', '')::timestamptz,
					scan."endDate"
				) as "observedAt",
				'history-scanner' as "source",
				(scan."archiveMetadata"->'stellarHistory'->>'version')::integer
					as "version",
				scan."archiveMetadata"->'stellarHistory'->>'server' as "server",
				(scan."archiveMetadata"->'stellarHistory'->>'currentLedger')::integer
					as "currentLedger",
				scan."archiveMetadata"->'stellarHistory'->>'networkPassphrase'
					as "networkPassphrase",
				scan."archiveMetadata"->'stellarHistory'->'currentBuckets'
					as "currentBuckets",
				scan."archiveMetadata"->'stellarHistory'->'hotArchiveBuckets'
					as "hotArchiveBuckets",
				scan."archiveMetadata"->'stellarHistory' as "rawState",
				now() as "createdAt",
				now() as "updatedAt"
			from "history_archive_scan_v2" scan
			where scan."archiveMetadata" is not null
			order by
				lower(regexp_replace(scan.url, '/+$', '')),
				scan."startDate" desc,
				scan.id desc
			on conflict ("archiveUrlIdentity") do update set
				"archiveUrl" = excluded."archiveUrl",
				"stateUrl" = excluded."stateUrl",
				"status" = excluded."status",
				"observedAt" = excluded."observedAt",
				"source" = excluded."source",
				"version" = excluded."version",
				"server" = excluded."server",
				"currentLedger" = excluded."currentLedger",
				"networkPassphrase" = excluded."networkPassphrase",
				"currentBuckets" = excluded."currentBuckets",
				"hotArchiveBuckets" = excluded."hotArchiveBuckets",
				"rawState" = excluded."rawState",
				"errorType" = null,
				"errorMessage" = null,
				"httpStatus" = null,
				"updatedAt" = now()
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists "history_archive_state_snapshot"
		`);
	}
}
