import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	checkpointProofRollupTriggerFunctionSql,
	checkpointProofRollupTriggersSql
} from '../../repositories/database/HistoryArchiveCheckpointProofRollupSql.js';
import {
	legacyCheckpointProofRollupTriggerFunctionSql,
	legacyCheckpointProofRollupTriggerSql
} from '../../repositories/database/HistoryArchiveCheckpointProofLegacyTriggerSql.js';

const triggerNames = [
	'trg_history_archive_checkpoint_proof_rollup',
	'trg_history_archive_checkpoint_proof_rollup_write',
	'trg_history_archive_checkpoint_proof_rollup_update'
] as const;

export class HistoryArchiveCheckpointProofSteadyStateMigration1785290000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofSteadyStateMigration1785290000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await dropRollupTriggers(queryRunner);
		await queryRunner.query(checkpointProofRollupTriggerFunctionSql);
		await queryRunner.query(checkpointProofRollupTriggersSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await setMigrationBounds(queryRunner);
		await dropRollupTriggers(queryRunner);
		await queryRunner.query(legacyCheckpointProofRollupTriggerFunctionSql);
		await queryRunner.query(legacyCheckpointProofRollupTriggerSql);
	}
}

async function setMigrationBounds(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		set local lock_timeout = '2s';
		set local statement_timeout = '30s'
	`);
}

async function dropRollupTriggers(queryRunner: QueryRunner): Promise<void> {
	for (const triggerName of triggerNames) {
		await queryRunner.query(`
			drop trigger if exists "${triggerName}"
			on history_archive_checkpoint_proof
		`);
	}
}
