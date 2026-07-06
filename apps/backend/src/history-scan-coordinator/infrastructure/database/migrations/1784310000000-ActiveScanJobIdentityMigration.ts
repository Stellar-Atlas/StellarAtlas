import { MigrationInterface, QueryRunner } from 'typeorm';

export class ActiveScanJobIdentityMigration1784310000000 implements MigrationInterface {
	name = 'ActiveScanJobIdentityMigration1784310000000';

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			with ranked as (
				select
					id,
					row_number() over (
						partition by
							lower(regexp_replace(url, '/+$', '')),
							coalesce("fromLedger", -1),
							coalesce("toLedger", -1)
						order by
							case when status = 'TAKEN' then 0 else 1 end,
							"updatedAt" desc,
							id desc
					) as row_number
				from history_archive_scan_job_queue
				where status in ('PENDING', 'TAKEN')
			)
			update history_archive_scan_job_queue job
			set
				status = 'DONE',
				"claimedByCommunityScannerId" = null,
				"claimedAt" = null,
				"updatedAt" = now()
			from ranked
			where job.id = ranked.id
				and ranked.row_number > 1
		`);

		await queryRunner.query(`
			create unique index if not exists idx_scanjob_active_identity
			on history_archive_scan_job_queue (
				lower(regexp_replace(url, '/+$', '')),
				coalesce("fromLedger", -1),
				coalesce("toLedger", -1)
			)
			where status in ('PENDING', 'TAKEN')
		`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists idx_scanjob_active_identity
		`);
	}
}
