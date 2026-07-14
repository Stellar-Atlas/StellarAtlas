import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveFalseBucketFailureCorrectionMigration1785050000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveFalseBucketFailureCorrectionMigration1785050000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			with false_failures as (
				select "remoteId"
				from history_archive_object_queue
				where "objectType" = 'bucket'
					and status = 'failed'
					and "errorType" = 'bucket_verification_failed'
					and lower(coalesce("errorMessage", '')) like '%abort%'
					and "verificationFacts" is null
			), corrected_events as (
				update history_archive_object_event event_row
				set "errorType" = 'archive_transport_error'
				from false_failures
				where event_row."objectRemoteId" = false_failures."remoteId"
					and event_row."errorType" = 'bucket_verification_failed'
					and lower(coalesce(event_row."errorMessage", '')) like '%abort%'
					and event_row."verificationFacts" is null
				returning event_row.id
			)
			update history_archive_object_queue object_row
			set "errorType" = 'archive_transport_error'
			from false_failures
			where object_row."remoteId" = false_failures."remoteId"
		`);
	}

	async down(_queryRunner: QueryRunner): Promise<void> {
		// This corrects false corruption evidence and must not be reversed.
	}
}
