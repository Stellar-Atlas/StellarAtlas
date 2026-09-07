import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveListingGapMigration1788735600000 implements MigrationInterface {
	readonly name = 'HistoryArchiveListingGapMigration1788735600000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table history_archive_listing_gap (
				"archiveUrlIdentity" text not null,
				"firstCheckpointLedger" integer not null,
				"lastCheckpointLedger" integer not null,
				"resumeCheckpointLedger" integer not null,
				"observedAt" timestamptz not null,
				"listingEvidence" jsonb not null,
				"sourceCheckpointProofId" bigint references history_archive_checkpoint_proof(id),
				"resolvedAt" timestamptz,
				primary key ("archiveUrlIdentity", "firstCheckpointLedger", "lastCheckpointLedger"),
				check ("firstCheckpointLedger" >= 63 and "firstCheckpointLedger" % 64 = 63),
				check ("lastCheckpointLedger" > "firstCheckpointLedger" and "lastCheckpointLedger" % 64 = 63),
				check ("resumeCheckpointLedger" = "lastCheckpointLedger" + 64),
				check (jsonb_typeof("listingEvidence") = 'object')
			);
			create index idx_history_archive_listing_gap_source
				on history_archive_listing_gap ("sourceCheckpointProofId")
				where "sourceCheckpointProofId" is not null;
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		// Never silently discard an operator's only evidence for unrequested files.
		const rows = await queryRunner.query(
			'select 1 from history_archive_listing_gap limit 1'
		);
		if (rows.length > 0)
			throw new Error(
				'Archive listing evidence must be preserved before rollback'
			);
		await queryRunner.query('drop table history_archive_listing_gap');
	}
}
