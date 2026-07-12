import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ParsedLedgerClosedAtMigration1784840000000 implements MigrationInterface {
	name = 'ParsedLedgerClosedAtMigration1784840000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`
			alter table "parsed_ledger_header"
				add column if not exists "closedAt" timestamptz,
				add column if not exists "closedAtSourceArchiveUrl" text,
				add column if not exists "closedAtScanJobRemoteId" text,
				add column if not exists "closedAtObservedAt" timestamptz
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`
			alter table "parsed_ledger_header"
				drop column if exists "closedAtObservedAt",
				drop column if exists "closedAtScanJobRemoteId",
				drop column if exists "closedAtSourceArchiveUrl",
				drop column if exists "closedAt"
		`);
	}
}
