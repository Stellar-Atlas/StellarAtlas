import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveScanErrors1782890217000 implements MigrationInterface {
	name = 'HistoryArchiveScanErrors1782890217000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_v2" ADD "errors" jsonb NOT NULL DEFAULT '[]'::jsonb`
		);
		await queryRunner.query(`
			UPDATE "history_archive_scan_v2" scan
			SET "errors" = jsonb_build_array(
				jsonb_build_object(
					'type',
					CASE error."type"
						WHEN '0' THEN 'TYPE_VERIFICATION'
						WHEN '1' THEN 'TYPE_CONNECTION'
						ELSE error."type"::text
					END,
					'url',
					error."url",
					'message',
					error."message"
				)
			)
			FROM "history_archive_scan_error" error
			WHERE scan."errorId" = error."id"
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			`ALTER TABLE "history_archive_scan_v2" DROP COLUMN "errors"`
		);
	}
}
