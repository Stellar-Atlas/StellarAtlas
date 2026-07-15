import type { MigrationInterface, QueryRunner } from 'typeorm';
import { archiveObjectGlobalBucketHashIndexName } from '../../repositories/database/HistoryArchiveObjectBucketSummaryQuery.js';

export class HistoryArchiveGlobalBucketHashIndexMigration1785090000000 implements MigrationInterface {
	name = 'HistoryArchiveGlobalBucketHashIndexMigration1785090000000';
	transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists
				"${archiveObjectGlobalBucketHashIndexName}"
			on history_archive_object_queue ("bucketHash")
			where "objectType" = 'bucket'
				and "bucketHash" is not null
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index concurrently if exists
				"${archiveObjectGlobalBucketHashIndexName}"
		`);
	}
}
