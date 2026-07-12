import { MigrationInterface, type QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_object_bucket_hash';

export class HistoryArchiveObjectBucketHashIndexMigration1784890000000 implements MigrationInterface {
	name = 'HistoryArchiveObjectBucketHashIndexMigration1784890000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on "history_archive_object_queue" (
				"archiveUrlIdentity",
				"bucketHash"
			)
			include (status, "executionDisposition", "dependencyReady")
			where "objectType" = 'bucket'
				and "bucketHash" is not null
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop index concurrently if exists "${indexName}"`);
	}
}
