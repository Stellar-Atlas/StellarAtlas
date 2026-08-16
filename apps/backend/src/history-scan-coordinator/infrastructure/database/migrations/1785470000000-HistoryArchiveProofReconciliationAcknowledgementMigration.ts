import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveProofReconciliationAcknowledgementMigration1785470000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveProofReconciliationAcknowledgementMigration1785470000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			add column if not exists "proofReconciledAt" timestamptz
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await queryRunner.query(`
			alter table "history_archive_object_queue"
			drop column if exists "proofReconciledAt"
		`);
	}
}

async function setMigrationBounds(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}
