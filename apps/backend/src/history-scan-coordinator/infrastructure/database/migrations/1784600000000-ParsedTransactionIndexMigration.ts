import { MigrationInterface, QueryRunner } from 'typeorm';

export class ParsedTransactionIndexMigration1784600000000 implements MigrationInterface {
	name = 'ParsedTransactionIndexMigration1784600000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "parsed_transaction_envelope" (
				"id" serial not null,
				"ledgerSequence" bigint not null,
				"transactionIndex" integer not null,
				"transactionSetHash" text not null,
				"envelopeXdr" text not null,
				"firstSourceArchiveUrl" text not null,
				"lastSourceArchiveUrl" text not null,
				"lastScanJobRemoteId" text not null,
				"firstSeenAt" timestamptz not null,
				"lastSeenAt" timestamptz not null,
				constraint "PK_parsed_transaction_envelope_id" primary key ("id")
			)
		`);
		await queryRunner.query(`
			create unique index if not exists
				"IDX_parsed_transaction_envelope_identity"
			on "parsed_transaction_envelope"
				("ledgerSequence", "transactionSetHash", "transactionIndex")
		`);

		await queryRunner.query(`
			create table if not exists "parsed_transaction_result" (
				"id" serial not null,
				"ledgerSequence" bigint not null,
				"transactionIndex" integer not null,
				"transactionResultHash" text not null,
				"transactionHash" text not null,
				"resultXdr" text not null,
				"firstSourceArchiveUrl" text not null,
				"lastSourceArchiveUrl" text not null,
				"lastScanJobRemoteId" text not null,
				"firstSeenAt" timestamptz not null,
				"lastSeenAt" timestamptz not null,
				constraint "PK_parsed_transaction_result_id" primary key ("id")
			)
		`);
		await queryRunner.query(`
			create unique index if not exists
				"IDX_parsed_transaction_result_identity"
			on "parsed_transaction_result"
				("ledgerSequence", "transactionResultHash", "transactionIndex")
		`);
		await queryRunner.query(`
			create index if not exists "IDX_parsed_transaction_result_hash"
			on "parsed_transaction_result" ("transactionHash")
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop index if exists "IDX_parsed_transaction_result_hash"'
		);
		await queryRunner.query(
			'drop index if exists "IDX_parsed_transaction_result_identity"'
		);
		await queryRunner.query('drop table if exists "parsed_transaction_result"');
		await queryRunner.query(
			'drop index if exists "IDX_parsed_transaction_envelope_identity"'
		);
		await queryRunner.query(
			'drop table if exists "parsed_transaction_envelope"'
		);
	}
}
