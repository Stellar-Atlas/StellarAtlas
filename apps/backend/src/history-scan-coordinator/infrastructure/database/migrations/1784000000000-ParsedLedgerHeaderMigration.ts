import { MigrationInterface, QueryRunner } from 'typeorm';

export class ParsedLedgerHeaderMigration1784000000000
	implements MigrationInterface
{
	name = 'ParsedLedgerHeaderMigration1784000000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "parsed_ledger_header" (
				"id" serial not null,
				"ledgerSequence" bigint not null,
				"ledgerHeaderHash" text not null,
				"previousLedgerHeaderHash" text not null,
				"transactionSetHash" text not null,
				"transactionResultHash" text not null,
				"bucketListHash" text not null,
				"protocolVersion" integer not null,
				"firstSourceArchiveUrl" text not null,
				"lastSourceArchiveUrl" text not null,
				"lastScanJobRemoteId" text not null,
				"firstSeenAt" timestamptz not null,
				"lastSeenAt" timestamptz not null,
				constraint "PK_parsed_ledger_header_id" primary key ("id")
			)
		`);
		await queryRunner.query(`
			create unique index if not exists
				"IDX_parsed_ledger_header_sequence_hash"
			on "parsed_ledger_header" ("ledgerSequence", "ledgerHeaderHash")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop index if exists "IDX_parsed_ledger_header_sequence_hash"'
		);
		await queryRunner.query('drop table if exists "parsed_ledger_header"');
	}
}
