import type { MigrationInterface, QueryRunner } from 'typeorm';
import { historyArchiveTransientSourceRetrySchemaSql } from '../../repositories/database/HistoryArchiveTransientSourceRetry.js';

/** No queue rewrite or index build: one small durable sweep cursor. */
export class HistoryArchiveTransientSourceRetryMigration1791072000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveTransientSourceRetryMigration1791072000000';
	async up(runner: QueryRunner): Promise<void> {
		await runner.query(historyArchiveTransientSourceRetrySchemaSql);
	}
	async down(runner: QueryRunner): Promise<void> {
		await runner.query(
			'drop table if exists history_archive_transient_source_retry_sweep'
		);
	}
}
