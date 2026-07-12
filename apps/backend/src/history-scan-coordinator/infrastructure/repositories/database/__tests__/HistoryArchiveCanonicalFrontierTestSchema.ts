import type { DataSource } from 'typeorm';

export async function createCanonicalFrontierTestSchema(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		create table if not exists "history_archive_state_snapshot" (
			"archiveUrlIdentity" text primary key,
			status text not null,
			"networkPassphrase" text
		)
	`);
	await dataSource.query(`
		create table if not exists "full_history_promotion_runtime" (
			"network_passphrase_hash" bytea primary key,
			state text not null,
			"checkpoint_ledger" bigint
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
