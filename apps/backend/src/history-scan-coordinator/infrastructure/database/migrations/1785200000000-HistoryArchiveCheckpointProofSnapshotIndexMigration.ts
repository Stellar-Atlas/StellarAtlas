import { MigrationInterface, type QueryRunner } from 'typeorm';

export const historyArchiveCheckpointProofSnapshotIndex =
	'idx_history_archive_checkpoint_proof_snapshot';

export class HistoryArchiveCheckpointProofSnapshotIndexMigration1785200000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofSnapshotIndexMigration1785200000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create index concurrently if not exists
				"${historyArchiveCheckpointProofSnapshotIndex}"
			on history_archive_checkpoint_proof (
				"archiveUrlIdentity",
				"createdAt"
			)
			include (status)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index concurrently if exists
				"${historyArchiveCheckpointProofSnapshotIndex}"
		`);
	}
}
