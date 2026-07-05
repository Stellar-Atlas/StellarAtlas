import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveScanEvidenceMigration1784100000000 implements MigrationInterface {
	name = 'HistoryArchiveScanEvidenceMigration1784100000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_scan_evidence" (
				"id" serial not null,
				"scanId" integer not null,
				"archiveUrl" text not null,
				"scanJobRemoteId" text not null,
				"kind" text not null,
				"status" text not null,
				"bucketHash" text not null,
				"bucketUrl" text not null,
				"observedAt" timestamptz not null,
				constraint "PK_history_archive_scan_evidence_id" primary key ("id"),
				constraint "FK_history_archive_scan_evidence_scan"
					foreign key ("scanId")
					references "history_archive_scan_v2"("id")
					on delete cascade
			)
		`);
		await queryRunner.query(`
			create index if not exists "IDX_history_archive_scan_evidence_archive_time"
			on "history_archive_scan_evidence" ("archiveUrl", "observedAt")
		`);
		await queryRunner.query(`
			create index if not exists "IDX_history_archive_scan_evidence_job"
			on "history_archive_scan_evidence" ("scanJobRemoteId")
		`);
		await queryRunner.query(`
			create unique index if not exists "IDX_history_archive_scan_evidence_scan_bucket"
			on "history_archive_scan_evidence" ("scanId", "kind", "bucketHash")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop index if exists "IDX_history_archive_scan_evidence_scan_bucket"'
		);
		await queryRunner.query(
			'drop index if exists "IDX_history_archive_scan_evidence_job"'
		);
		await queryRunner.query(
			'drop index if exists "IDX_history_archive_scan_evidence_archive_time"'
		);
		await queryRunner.query(
			'drop table if exists "history_archive_scan_evidence"'
		);
	}
}
