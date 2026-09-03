import type { DataSource } from 'typeorm';

export async function createCanonicalFrontierTestSchema(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		create table if not exists "history_archive_object_ready" (
			"objectRemoteId" uuid primary key references
				"history_archive_object_queue" ("remoteId") on delete cascade,
			"archiveUrlIdentity" text not null unique,
			priority smallint not null check (priority between 0 and 2),
			"availableAt" timestamptz not null default now(),
			"createdAt" timestamptz not null default now(),
                        "updatedAt" timestamptz not null default now(),
                        "dispatchToken" uuid,
                        "claimAttempt" integer,
                        "publishedAt" timestamptz
		)
	`);
	await dataSource.query(`
		create table if not exists "history_archive_state_snapshot" (
			"archiveUrlIdentity" text primary key,
			status text not null,
                        "networkPassphrase" text,
                        "currentLedger" integer
		)
	`);
	await dataSource.query(`
                create table if not exists "history_archive_checkpoint_scan_cursor" (
                        "archiveUrlIdentity" text primary key,
                        "latestCheckpointLedger" integer not null,
                        "lastForwardCheckpointLedger" integer,
                        "nextHistoricalCheckpointLedger" integer,
                        "createdAt" timestamptz not null default now(),
                        "updatedAt" timestamptz not null default now()
                )
        `);
	await dataSource.query(`
		create table if not exists "history_archive_checkpoint_substitution" (
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			"failedCheckpointProofId" integer not null references
				"history_archive_checkpoint_proof" (id),
			"sourceArchiveUrlIdentity" text not null,
			"sourceCheckpointProofId" integer not null references
				"history_archive_checkpoint_proof" (id),
			reason text not null,
			"createdAt" timestamptz not null default now(),
			primary key ("archiveUrlIdentity", "checkpointLedger"),
			check ("archiveUrlIdentity" <> "sourceArchiveUrlIdentity"),
			check (reason = 'remote-http-missing')
		)
	`);
	await dataSource.query(`
		create table if not exists "history_archive_checkpoint_bucket_dependency" (
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			"bucketHash" text not null,
			primary key ("archiveUrlIdentity", "checkpointLedger", "bucketHash")
		)
	`);
	await dataSource.query(`
		create table if not exists "full_history_promotion_runtime" (
			"network_passphrase_hash" bytea primary key,
			state text not null,
			"checkpoint_ledger" bigint,
			"last_outcome" text,
			"last_error_code" text
		)
	`);
	await dataSource.query(`
		create table if not exists "full_history_watermark" (
			"network_passphrase_hash" bytea primary key,
			"first_ledger" bigint not null
		)
	`);
	await dataSource.query(`
		create table if not exists "full_history_historical_backfill_job" (
			id uuid primary key,
			"network_passphrase_hash" bytea not null,
			"first_checkpoint_ledger" bigint not null,
			"last_checkpoint_ledger" bigint not null,
			state text not null,
			"created_at" timestamptz not null default now()
		)
	`);
}
