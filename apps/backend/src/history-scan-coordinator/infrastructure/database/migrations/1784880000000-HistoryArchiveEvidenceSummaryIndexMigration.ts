import { MigrationInterface, type QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_object_evidence_summary';

export class HistoryArchiveEvidenceSummaryIndexMigration1784880000000 implements MigrationInterface {
	name = 'HistoryArchiveEvidenceSummaryIndexMigration1784880000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on "history_archive_object_queue" (
				"archiveUrlIdentity",
				"createdAt"
			)
			include (
				status,
				"objectType",
				"failureChannel"
			)
		`);
		await queryRunner.query(`
			analyze (skip_locked)
			"history_archive_object_queue" (
				"archiveUrlIdentity",
				"createdAt",
				status,
				"objectType",
				"failureChannel"
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}
