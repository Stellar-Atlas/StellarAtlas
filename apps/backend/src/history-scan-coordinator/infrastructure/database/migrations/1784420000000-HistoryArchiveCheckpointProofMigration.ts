import { MigrationInterface, QueryRunner } from 'typeorm';

export class HistoryArchiveCheckpointProofMigration1784420000000 implements MigrationInterface {
	name = 'HistoryArchiveCheckpointProofMigration1784420000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			create table if not exists "history_archive_checkpoint_proof" (
				"id" serial not null,
				"archiveUrl" text not null,
				"archiveUrlIdentity" text not null,
				"checkpointLedger" integer not null,
				"status" text not null,
				"proofVersion" smallint not null default 1,
				"requiredObjectsComplete" boolean not null,
				"proofFactsComplete" boolean not null,
				"checkpointBucketListMatches" boolean not null,
				"transactionsMatch" boolean not null,
				"resultsMatch" boolean not null,
				"previousLedgersMatch" boolean not null,
				"bucketsVerified" boolean not null,
				"ledgerFactCount" integer not null default 0,
				"transactionFactCount" integer not null default 0,
				"resultFactCount" integer not null default 0,
				"expectedBucketCount" integer not null default 0,
				"verifiedBucketCount" integer not null default 0,
				"failedBucketCount" integer not null default 0,
				"missingBucketCount" integer not null default 0,
				"checkpointBucketListHash" text,
				"ledgerBucketListHash" text,
				"checkpointStateObjectRemoteId" uuid,
				"ledgerObjectRemoteId" uuid,
				"transactionsObjectRemoteId" uuid,
				"resultsObjectRemoteId" uuid,
				"scpObjectRemoteId" uuid,
				"failureKind" text,
				"details" jsonb,
				"evaluatedAt" timestamptz not null,
				"createdAt" timestamptz not null default now(),
				"updatedAt" timestamptz not null default now(),
				constraint "PK_history_archive_checkpoint_proof"
					primary key ("id"),
				constraint "UQ_history_archive_checkpoint_proof_identity"
					unique ("archiveUrlIdentity", "checkpointLedger"),
				constraint "CHK_history_archive_checkpoint_proof_status"
					check ("status" in (
						'pending',
						'verified',
						'mismatch',
						'not-evaluable'
					)),
				constraint "CHK_history_archive_checkpoint_proof_failure"
					check (
						"failureKind" is null
						or "failureKind" in (
							'object-incomplete',
							'object-failed',
							'proof-facts-incomplete',
							'checkpoint-bucket-list-mismatch',
							'transaction-hash-mismatch',
							'result-hash-mismatch',
							'previous-ledger-hash-mismatch',
							'bucket-missing'
						)
					),
				constraint "CHK_history_archive_checkpoint_proof_counts"
					check (
						"ledgerFactCount" >= 0
						and "transactionFactCount" >= 0
						and "resultFactCount" >= 0
						and "expectedBucketCount" >= 0
						and "verifiedBucketCount" >= 0
						and "failedBucketCount" >= 0
						and "missingBucketCount" >= 0
					)
			)
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_checkpoint_proof_status"
			on "history_archive_checkpoint_proof" ("status", "evaluatedAt")
		`);
		await queryRunner.query(`
			create index if not exists "idx_history_archive_checkpoint_proof_archive"
			on "history_archive_checkpoint_proof" ("archiveUrlIdentity", "status")
		`);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`
			drop index if exists "idx_history_archive_checkpoint_proof_archive"
		`);
		await queryRunner.query(`
			drop index if exists "idx_history_archive_checkpoint_proof_status"
		`);
		await queryRunner.query(`
			drop table if exists "history_archive_checkpoint_proof"
		`);
	}
}
