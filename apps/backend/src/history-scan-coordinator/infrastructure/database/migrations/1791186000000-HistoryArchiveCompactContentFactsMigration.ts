import type { MigrationInterface, QueryRunner } from 'typeorm';
import { historyArchiveCompactContentFactsSql } from '../../repositories/database/HistoryArchiveCompactContentFactsSql.js';

export class HistoryArchiveCompactContentFactsMigration1791186000000 implements MigrationInterface {
	name = 'HistoryArchiveCompactContentFactsMigration1791186000000';
	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveCompactContentFactsSql);
	}
	async down(): Promise<void> {
		throw new Error(
			'Disable compact writes but retain readers for existing references'
		);
	}
}
