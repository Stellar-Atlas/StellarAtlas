import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveCheckpointProofRefreshQueueMigration1785510000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists history_archive_checkpoint_proof_refresh_queue (
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"evidenceUpdatedAt" timestamptz not null,
				generation bigint not null default 1,
				"requestedAt" timestamptz not null default now(),
				attempts integer not null default 0,
				"lastAttemptAt" timestamptz,
				"nextAttemptAt" timestamptz not null default now(),
				"lastError" text,
				"leaseToken" uuid,
				"leaseUntil" timestamptz,
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_proof_refresh_queue"
					primary key ("archiveUrlIdentity", "checkpointLedger"),
				constraint "CHK_history_archive_checkpoint_proof_refresh_queue_ledger"
					check (
						"checkpointLedger" >= 63
						and "checkpointLedger" % 64 = 63
					),
				constraint "CHK_history_archive_checkpoint_proof_refresh_queue_attempts"
					check (attempts >= 0),
				constraint "CHK_history_archive_checkpoint_proof_refresh_queue_generation"
					check (generation >= 1),
				constraint "CHK_history_archive_checkpoint_proof_refresh_queue_lease"
					check (
						("leaseToken" is null and "leaseUntil" is null)
						or ("leaseToken" is not null and "leaseUntil" is not null)
					)
			)
		`);
		await queryRunner.query(`
			create index if not exists
				"IDX_history_archive_checkpoint_proof_refresh_queue_due"
			on history_archive_checkpoint_proof_refresh_queue (
				"nextAttemptAt", "requestedAt", "archiveUrlIdentity",
				"checkpointLedger"
			)
			include ("leaseUntil", attempts)
		`);
		await queryRunner.query(`
			create table if not exists
				history_archive_checkpoint_proof_refresh_seed_progress (
				id smallint primary key,
				"cutoffProofId" bigint not null,
				"lastProofId" bigint not null default 0,
				complete boolean not null default false,
				"startedAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "CHK_history_archive_checkpoint_proof_refresh_seed_id"
					check (id = 1),
				constraint "CHK_history_archive_checkpoint_proof_refresh_seed_bounds"
					check (
						"lastProofId" >= 0
						and "cutoffProofId" >= "lastProofId"
					)
			)
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop table if exists
				history_archive_checkpoint_proof_refresh_seed_progress
		`);
		await queryRunner.query(
			'drop table if exists history_archive_checkpoint_proof_refresh_queue'
		);
	}
}
