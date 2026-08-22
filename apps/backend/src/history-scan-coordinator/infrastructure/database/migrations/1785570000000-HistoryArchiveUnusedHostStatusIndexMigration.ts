import type { MigrationInterface, QueryRunner } from 'typeorm';

const unusedHostStatusIndex = 'idx_history_archive_object_host';

export class HistoryArchiveUnusedHostStatusIndexMigration1785570000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveUnusedHostStatusIndexMigration1785570000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`drop index concurrently if exists "${unusedHostStatusIndex}"`
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
                        create index concurrently if not exists
                                "${unusedHostStatusIndex}"
                        on "history_archive_object_queue" (
                                "hostIdentity",
                                status
                        )
                `);
	}
}
