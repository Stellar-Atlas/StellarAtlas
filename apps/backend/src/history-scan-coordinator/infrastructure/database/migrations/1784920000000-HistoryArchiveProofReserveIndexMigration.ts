import { MigrationInterface, type QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_object_proof_reserve';

export class HistoryArchiveProofReserveIndexMigration1784920000000 implements MigrationInterface {
	name = 'HistoryArchiveProofReserveIndexMigration1784920000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on "history_archive_object_queue" (
				"archiveUrlIdentity", status, "objectKey", id
			)
			where "executionDisposition" = 'executable'
				and "dependencyReady" = true
				and "executionReason" = 'proof-completion-reserve'
				and status in ('pending', 'scanning')
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}
