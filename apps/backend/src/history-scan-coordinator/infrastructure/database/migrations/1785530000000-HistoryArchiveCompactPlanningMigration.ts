import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveCompactPlanningMigration1785530000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveCompactPlanningMigration1785530000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
                        alter table "history_archive_object_queue"
                        add column if not exists "descendantsPlannedAt" timestamptz default now();
                        alter table "history_archive_object_queue"
                        alter column "descendantsPlannedAt" drop default
                `);
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_scan_cursor" (
				"archiveUrlIdentity" text primary key,
				"latestCheckpointLedger" integer not null,
				"lastForwardCheckpointLedger" integer,
				"nextHistoricalCheckpointLedger" integer,
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "CK_history_archive_checkpoint_scan_cursor_latest"
					check (
						"latestCheckpointLedger" >= 63
						and (("latestCheckpointLedger" + 1) % 64) = 0
					),
				constraint "CK_history_archive_checkpoint_scan_cursor_forward"
					check (
						"lastForwardCheckpointLedger" is null
						or (
							"lastForwardCheckpointLedger" >= 63
							and (("lastForwardCheckpointLedger" + 1) % 64) = 0
						)
					),
				constraint "CK_history_archive_checkpoint_scan_cursor_historical"
					check (
						"nextHistoricalCheckpointLedger" is null
						or (
							"nextHistoricalCheckpointLedger" >= 63
							and (("nextHistoricalCheckpointLedger" + 1) % 64) = 0
						)
					)
			)
		`);
		await queryRunner.query(`
			create index concurrently if not exists
				"idx_history_archive_checkpoint_fanout"
			on "history_archive_object_queue" ("verifiedAt" desc, id)
			where "objectType" = 'checkpoint-state'
				and status = 'verified'
				and "descendantsPlannedAt" is null
		`);
	}

	async down(): Promise<void> {
		throw new Error(
			'Compact archive planning is forward-only because its cursor replaces expanded future intent'
		);
	}
}
