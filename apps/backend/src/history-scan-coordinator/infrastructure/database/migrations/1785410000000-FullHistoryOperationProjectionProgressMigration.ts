import type { MigrationInterface, QueryRunner } from 'typeorm';

const progressTable = 'full_history_operation_projection_progress';

export class FullHistoryOperationProjectionProgressMigration1785410000000 implements MigrationInterface {
	readonly name =
		'FullHistoryOperationProjectionProgressMigration1785410000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "${progressTable}" (
				"batch_id" uuid not null references
					"full_history_ingestion_batch" (id) on delete cascade,
				"projection" varchar(64) not null,
				"decoder_version" varchar(128) not null,
				"expected_count" integer not null,
				"next_offset" integer not null default 0,
				"updated_at" timestamptz not null default now(),
				constraint "pk_full_history_operation_projection_progress"
					primary key ("batch_id", "projection"),
				constraint "ck_full_history_operation_projection_expected"
					check ("expected_count" >= 0),
				constraint "ck_full_history_operation_projection_offset"
					check (
						"next_offset" >= 0
						and "next_offset" <= "expected_count"
					)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`drop table if exists "${progressTable}"`);
	}
}
