import type { MigrationInterface, QueryRunner } from 'typeorm';

const queueIndex = 'idx_history_archive_object_remote';
const eventIndex = 'idx_history_archive_object_event_remote_unique';

export class HistoryArchiveDuplicateIdentityIndexMigration1785310000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveDuplicateIdentityIndexMigration1785310000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			alter table "history_archive_object_claim_slot"
				drop constraint if exists "CHK_history_archive_object_claim_slot_range"
		`);
		await queryRunner.query(
			`drop index concurrently if exists "${queueIndex}"`
		);
		await queryRunner.query(
			`drop index concurrently if exists "${eventIndex}"`
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create unique index concurrently if not exists "${queueIndex}"
				on "history_archive_object_queue" ("remoteId")
		`);
		await queryRunner.query(`
			create unique index concurrently if not exists "${eventIndex}"
				on "history_archive_object_event" ("remoteId")
		`);
	}
}
