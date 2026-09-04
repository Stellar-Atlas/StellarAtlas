import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveSharedCheckpointReadMigration1788496000000 implements MigrationInterface {
	name = 'HistoryArchiveSharedCheckpointReadMigration1788496000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create or replace view
				"history_archive_checkpoint_bucket_dependency_current"
			as
			select observation."archiveUrlIdentity",
				observation."checkpointLedger",
				member."bucketHash",
				coalesce(
					checkpoint."dependenciesMaterializedAt",
					checkpoint."verifiedAt",
					observation."createdAt"
				) as "createdAt"
			from "history_archive_checkpoint_content_observation" observation
			join "history_archive_checkpoint_content" content
				on content."contentDigest" = observation."contentDigest"
			join "history_archive_checkpoint_bucket_set_member" member
				on member."bucketSetDigest" = content."bucketSetDigest"
			left join "history_archive_object_queue" checkpoint
				on checkpoint."remoteId" =
					observation."checkpointStateObjectRemoteId"
			union all
			select legacy."archiveUrlIdentity",
				legacy."checkpointLedger",
				legacy."bucketHash",
				legacy."createdAt"
			from "history_archive_checkpoint_bucket_dependency" legacy
			where not exists (
				select 1
				from "history_archive_checkpoint_content_observation" observation
				where observation."archiveUrlIdentity" =
					legacy."archiveUrlIdentity"
					and observation."checkpointLedger" =
						legacy."checkpointLedger"
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop view if exists
				"history_archive_checkpoint_bucket_dependency_current"
		`);
	}
}
