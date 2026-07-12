import type { MigrationInterface, QueryRunner } from 'typeorm';

const constraintName = 'CHK_history_archive_checkpoint_proof_failure';

export class HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofPredecessorFailureMigration1784870000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`alter table history_archive_checkpoint_proof
			 drop constraint if exists "${constraintName}"`
		);
		await queryRunner.query(
			`alter table history_archive_checkpoint_proof
			 add constraint "${constraintName}" check (
				"failureKind" is null or "failureKind" in (
					'object-incomplete', 'object-failed', 'proof-facts-incomplete',
					'checkpoint-bucket-list-mismatch', 'transaction-hash-mismatch',
					'result-hash-mismatch', 'previous-ledger-hash-mismatch',
					'predecessor-missing', 'bucket-missing'
				)
			) not valid`
		);
		await queryRunner.query(
			`alter table history_archive_checkpoint_proof
			 validate constraint "${constraintName}"`
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`alter table history_archive_checkpoint_proof
			 drop constraint if exists "${constraintName}"`
		);
		await queryRunner.query(
			`alter table history_archive_checkpoint_proof
			 add constraint "${constraintName}" check (
				"failureKind" is null or "failureKind" in (
					'object-incomplete', 'object-failed', 'proof-facts-incomplete',
					'checkpoint-bucket-list-mismatch', 'transaction-hash-mismatch',
					'result-hash-mismatch', 'previous-ledger-hash-mismatch',
					'bucket-missing'
				)
			)`
		);
	}
}
