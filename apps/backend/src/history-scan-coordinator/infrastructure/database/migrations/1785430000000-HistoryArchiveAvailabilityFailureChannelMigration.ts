import { MigrationInterface, type QueryRunner } from 'typeorm';

export class HistoryArchiveAvailabilityFailureChannelMigration1785430000000
	implements MigrationInterface
{
	public readonly name =
		'HistoryArchiveAvailabilityFailureChannelMigration1785430000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await replaceFailureChannelConstraints(queryRunner, true);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		for (const table of [
			'history_archive_object_queue',
			'history_archive_object_event'
		] as const) {
			await queryRunner.query(
				`update "${table}"
				 set "failureChannel" = 'archive_evidence'
				 where "failureChannel" = 'archive_availability'`
			);
		}
		await replaceFailureChannelConstraints(queryRunner, false);
	}
}

async function replaceFailureChannelConstraints(
	queryRunner: QueryRunner,
	includeAvailability: boolean
): Promise<void> {
	const acceptedChannels = includeAvailability
		? "'archive_evidence', 'archive_availability', 'scanner_issue'"
		: "'archive_evidence', 'scanner_issue'";
	for (const [table, constraint] of [
		[
			'history_archive_object_queue',
			'chk_history_archive_object_failure_channel'
		],
		['history_archive_object_event', 'chk_history_archive_event_failure_channel']
	] as const) {
		await queryRunner.query(
			`alter table "${table}" drop constraint if exists "${constraint}"`
		);
		await queryRunner.query(`
			alter table "${table}"
				add constraint "${constraint}"
				check (
					"failureChannel" is null
					or "failureChannel" in (${acceptedChannels})
				) not valid
		`);
	}
}
