import type { MigrationInterface, QueryRunner } from 'typeorm';
import { historyArchiveCompactContentFactsSql } from '../../repositories/database/HistoryArchiveCompactContentFactsSql.js';
import {
	historyArchiveDbCompactTemplateSchemaSql,
	historyArchiveDbCompactTemplateValidationSql
} from '../../repositories/database/HistoryArchiveDbCompactTemplateSql.js';

export class HistoryArchiveDbCompactTemplateMigration1791331200000 implements MigrationInterface {
	name = 'HistoryArchiveDbCompactTemplateMigration1791331200000';
	async up(queryRunner: QueryRunner): Promise<void> {
		const tablespace = process.env.HISTORY_ARCHIVE_COMPACT_TEMPLATE_TABLESPACE;
		if (!tablespace)
			throw new Error(
				'HISTORY_ARCHIVE_COMPACT_TEMPLATE_TABLESPACE is required'
			);
		await queryRunner.query(
			historyArchiveDbCompactTemplateSchemaSql(tablespace)
		);
		await queryRunner.query(historyArchiveDbCompactTemplateValidationSql);
	}
	async down(queryRunner: QueryRunner): Promise<void> {
		// Preserve existing compact readers and the derived cache; revert only
		// the validator fast path. No original evidence or mutation guard changes.
		await queryRunner.query(historyArchiveCompactContentFactsSql);
	}
}
