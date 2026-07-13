import type { MigrationInterface, QueryRunner } from 'typeorm';

export const historyArchiveObjectEventRecentIndexSql = `
	create index concurrently if not exists
		"idx_history_archive_object_event_recent"
	on history_archive_object_event ("createdAt" desc, id desc)
`;

export class HistoryArchiveObjectEventRecentIndexMigration1785020000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveObjectEventRecentIndexMigration1785020000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(historyArchiveObjectEventRecentIndexSql);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop index concurrently if exists "idx_history_archive_object_event_recent"'
		);
	}
}
