import { MigrationInterface, QueryRunner } from 'typeorm';

export class NetworkScanArchiveSchedulingMigration1784320000000 implements MigrationInterface {
	name = 'NetworkScanArchiveSchedulingMigration1784320000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "network_scan"
			add column if not exists "historyArchiveSchedulingDiscoveredUrlCount" integer not null default 0,
			add column if not exists "historyArchiveSchedulingScheduledCount" integer not null default 0,
			add column if not exists "historyArchiveSchedulingDuplicateSuppressedCount" integer not null default 0,
			add column if not exists "historyArchiveSchedulingErrorCount" integer not null default 0
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "network_scan"
			drop column if exists "historyArchiveSchedulingErrorCount",
			drop column if exists "historyArchiveSchedulingDuplicateSuppressedCount",
			drop column if exists "historyArchiveSchedulingScheduledCount",
			drop column if exists "historyArchiveSchedulingDiscoveredUrlCount"
		`);
	}
}
