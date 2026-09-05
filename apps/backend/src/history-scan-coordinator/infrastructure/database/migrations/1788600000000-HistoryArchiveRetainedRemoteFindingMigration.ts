import type { MigrationInterface, QueryRunner } from 'typeorm';
import { historyArchiveRetainedRemoteFindingSql } from '../../repositories/database/HistoryArchiveRetainedRemoteFindingSql.js';

/**
 * Empty sparse projection: no queue rewrite, index build, history backfill or
 * event/proof writes. Existing current failures remain in their indexed source.
 * Deploy before readers; removal would discard only newly retained findings.
 */
export class HistoryArchiveRetainedRemoteFindingMigration1788600000000 implements MigrationInterface {
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveRetainedRemoteFindingSql);
	}

	async down(): Promise<void> {
		throw new Error(
			'Retained source evidence must not be discarded by rollback'
		);
	}
}
