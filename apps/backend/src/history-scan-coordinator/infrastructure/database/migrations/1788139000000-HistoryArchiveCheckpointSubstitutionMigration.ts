import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveCheckpointSubstitutionMigration1788139000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveCheckpointSubstitutionMigration1788139000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_substitution" (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"failedCheckpointProofId" integer not null,
				"sourceArchiveUrlIdentity" text not null,
				"sourceCheckpointProofId" integer not null,
				reason text not null,
				"createdAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_substitution"
					primary key ("archiveUrlIdentity", "checkpointLedger"),
				constraint "FK_history_archive_checkpoint_substitution_failed"
					foreign key ("failedCheckpointProofId")
					references "history_archive_checkpoint_proof" (id)
					on delete restrict,
				constraint "FK_history_archive_checkpoint_substitution_source"
					foreign key ("sourceCheckpointProofId")
					references "history_archive_checkpoint_proof" (id)
					on delete restrict,
				constraint "CK_history_archive_checkpoint_substitution_distinct"
					check ("archiveUrlIdentity" <> "sourceArchiveUrlIdentity"),
				constraint "CK_history_archive_checkpoint_substitution_reason"
					check (reason = 'remote-http-missing')
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"IDX_history_archive_checkpoint_substitution_source"
			on "history_archive_checkpoint_substitution" (
				"sourceArchiveUrlIdentity", "checkpointLedger"
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(
			'drop table if exists "history_archive_checkpoint_substitution"'
		);
	}
}
