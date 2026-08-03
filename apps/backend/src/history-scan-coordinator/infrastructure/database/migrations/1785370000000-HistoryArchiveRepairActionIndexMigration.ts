import type { MigrationInterface, QueryRunner } from 'typeorm';

const indexName = 'idx_history_archive_object_repair_action';

export class HistoryArchiveRepairActionIndexMigration1785370000000
	implements MigrationInterface
{
	readonly name =
		'HistoryArchiveRepairActionIndexMigration1785370000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists "${indexName}"
			on "history_archive_object_queue" (
				"archiveUrlIdentity",
				"updatedAt" desc,
				"objectOrder",
				"objectKey"
			)
			where status = 'failed'
				and coalesce("failureChannel", 'archive_evidence') = 'archive_evidence'
				and (
					"httpStatus" in (404, 410)
					or (
						("httpStatus" is null or "httpStatus" < 400)
						and lower(coalesce("errorMessage", '')) not like '%abort%'
						and (
							replace(lower(coalesce("errorType", '')), '-', '_') like '%not_found%'
							or replace(lower(coalesce("errorType", '')), '-', '_') like '%enoent%'
							or replace(lower(coalesce("errorType", '')), '-', '_') like '%missing%'
							or replace(lower(coalesce("errorType", '')), '-', '_') like '%hash%'
							or replace(lower(coalesce("errorType", '')), '-', '_') like '%mismatch%'
							or replace(lower(coalesce("errorType", '')), '-', '_') in (
								'bucket_verification_failed',
								'category_content_invalid',
								'invalid_checkpoint_state',
								'invalid_history_archive_state'
							)
						)
					)
				)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop index concurrently if exists "${indexName}"`
		);
	}
}
