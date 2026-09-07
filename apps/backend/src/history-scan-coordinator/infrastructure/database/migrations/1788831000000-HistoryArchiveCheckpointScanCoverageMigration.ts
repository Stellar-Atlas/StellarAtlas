import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Empty compact projections only. Historical reconciliation is separately bounded. */
export class HistoryArchiveCheckpointScanCoverageMigration1788831000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveCheckpointScanCoverageMigration1788831000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table history_archive_checkpoint_scan_bitmap (
				"archiveUrlIdentity" text not null,
				"pageIndex" integer not null check ("pageIndex" between 0 and 8191),
				"checkedBitmap" bit(4096) not null,
				"listingBitmap" bit(4096) not null,
				"checkedCheckpointCount" integer generated always as
					(bit_count("checkedBitmap")::integer) stored,
				"listingCheckpointCount" integer generated always as
					(bit_count("listingBitmap")::integer) stored,
				"scannedCheckpointCount" integer generated always as
					(bit_count("checkedBitmap" | "listingBitmap")::integer) stored,
				"lastAddedCheckedCount" integer not null check ("lastAddedCheckedCount" between 0 and 4096),
				"lastAddedListingCount" integer not null check ("lastAddedListingCount" between 0 and 4096),
				"lastAddedScannedCount" integer not null check ("lastAddedScannedCount" between 0 and 4096),
				"updatedAt" timestamptz not null default now(),
				primary key ("archiveUrlIdentity", "pageIndex")
			);
			create table history_archive_checkpoint_scan_summary (
				"archiveUrlIdentity" text primary key,
				"checkedCheckpointPositions" bigint not null check ("checkedCheckpointPositions" >= 0),
				"listingCoveredCheckpointPositions" bigint not null check ("listingCoveredCheckpointPositions" >= 0),
				"scannedCheckpointPositions" bigint not null check ("scannedCheckpointPositions" >= 0),
				"updatedAt" timestamptz not null default now()
			);
			create table history_archive_checkpoint_scan_seed_state (
				source text primary key check (source in ('queue', 'events', 'attestations', 'listings')),
				cursor jsonb not null default '{}',
				upper_bound jsonb,
				complete boolean not null default false,
				"updatedAt" timestamptz not null default now()
			);
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		const rows = await queryRunner.query(
			'select 1 from history_archive_checkpoint_scan_bitmap limit 1'
		);
		if (rows.length > 0)
			throw new Error(
				'Preserve recorded checkpoint scan coverage before rollback'
			);
		await queryRunner.query(`drop table history_archive_checkpoint_scan_seed_state,
			history_archive_checkpoint_scan_summary, history_archive_checkpoint_scan_bitmap`);
	}
}
