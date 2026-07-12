import type { QueryRunner } from 'typeorm';
import { ParsedLedgerClosedAtMigration1784840000000 } from '../1784840000000-ParsedLedgerClosedAtMigration.js';

describe('ParsedLedgerClosedAtMigration1784840000000', () => {
	const migration = new ParsedLedgerClosedAtMigration1784840000000();
	let queryRunner: { query: jest.Mock };

	beforeEach(() => {
		queryRunner = { query: jest.fn(async () => undefined) };
	});

	it('adds a nullable close-time column without a default or backfill', async () => {
		await migration.up(queryRunner as unknown as QueryRunner);
		const sql = queryRunner.query.mock.calls.join('\n').toLowerCase();

		expect(sql).toContain('add column if not exists "closedat" timestamptz');
		expect(sql).toContain(
			'add column if not exists "closedatsourcearchiveurl" text'
		);
		expect(sql).toContain(
			'add column if not exists "closedatscanjobremoteid" text'
		);
		expect(sql).toContain(
			'add column if not exists "closedatobservedat" timestamptz'
		);
		expect(sql).toContain("set local lock_timeout = '2s'");
		expect(sql).not.toContain(' default ');
		expect(sql).not.toContain('update "parsed_ledger_header"');
	});

	it('removes only the additive column', async () => {
		await migration.down(queryRunner as unknown as QueryRunner);
		const sql = queryRunner.query.mock.calls.join('\n').toLowerCase();

		expect(sql).toContain('drop column if exists "closedat"');
		expect(sql).toContain('drop column if exists "closedatsourcearchiveurl"');
		expect(sql).toContain('drop column if exists "closedatscanjobremoteid"');
		expect(sql).toContain('drop column if exists "closedatobservedat"');
		expect(sql).not.toContain('drop table');
	});
});
