import type { MigrationInterface, QueryRunner } from 'typeorm';

const proofVersionRollupView =
	'history_archive_checkpoint_proof_version_rollup';

export class HistoryArchiveCheckpointProofVersionRollupMigration1785400000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofVersionRollupMigration1785400000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create or replace view "${proofVersionRollupView}" as
			select
				"archiveUrlIdentity",
				"proofVersion",
				count(*) as "totalCheckpointProofs",
				count(*) filter (where status = 'pending')
					as "pendingCheckpointProofs",
				count(*) filter (where status = 'verified')
					as "verifiedCheckpointProofs",
				count(*) filter (where status = 'mismatch')
					as "mismatchCheckpointProofs",
				count(*) filter (where status = 'not-evaluable')
					as "notEvaluableCheckpointProofs",
				count(*) filter (where "requiredObjectsComplete")
					as "objectCompleteCheckpointProofs"
			from history_archive_checkpoint_proof
			group by "archiveUrlIdentity", "proofVersion"
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop view if exists "${proofVersionRollupView}"`);
	}
}
