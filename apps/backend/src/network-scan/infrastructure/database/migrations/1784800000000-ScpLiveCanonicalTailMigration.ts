import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScpLiveCanonicalTailMigration1784800000000 implements MigrationInterface {
	readonly name = 'ScpLiveCanonicalTailMigration1784800000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "scp_statement_projection_event" (
				"id" bigserial primary key,
				"statementHash" text not null,
				"createdAt" timestamptz not null default clock_timestamp()
			)
		`);
		await queryRunner.query(`
			create index if not exists "IDX_scp_projection_event_created_at"
			on "scp_statement_projection_event" ("createdAt", "id")
		`);
		await queryRunner.query(`
			create table if not exists "scp_latest_observed_ledger" (
				"id" smallint primary key default 1 check ("id" = 1),
				"sequence" numeric not null,
				"closedAt" timestamptz not null,
				"observedAt" timestamptz not null,
				"source" text not null check (
					"source" in ('network_scan', 'scp_live_collector')
				)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop table if exists "scp_latest_observed_ledger"`
		);
		await queryRunner.query(
			`drop index if exists "IDX_scp_projection_event_created_at"`
		);
		await queryRunner.query(
			`drop table if exists "scp_statement_projection_event"`
		);
	}
}
