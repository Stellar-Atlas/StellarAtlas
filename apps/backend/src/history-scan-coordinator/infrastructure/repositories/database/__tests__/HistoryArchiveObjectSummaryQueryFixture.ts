import type { DataSource, MigrationInterface } from 'typeorm';
import { HistoryArchiveObjectBucketHashIndexMigration1784890000000 } from '../../../database/migrations/1784890000000-HistoryArchiveObjectBucketHashIndexMigration.js';
import { HistoryArchiveObjectTypeSummaryMigration1785080000000 } from '../../../database/migrations/1785080000000-HistoryArchiveObjectTypeSummaryMigration.js';

export const archiveA = 'https://archive-a.example/history';
export const archiveB = 'https://archive-b.example/history';
export const bucketHashA = 'a'.repeat(64);
export const bucketHashB = 'b'.repeat(64);

export async function resetObjectSummaryFixture(
	dataSource: DataSource
): Promise<void> {
	await dropObjectSummaryFixture(dataSource);
	await createObjectSummaryFixtureSchema(dataSource);
	await seedObjectSummaryFixture(dataSource);
	await runMigration(
		dataSource,
		new HistoryArchiveObjectBucketHashIndexMigration1784890000000()
	);
	await runMigration(
		dataSource,
		new HistoryArchiveObjectTypeSummaryMigration1785080000000()
	);
}

async function dropObjectSummaryFixture(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		'drop table if exists history_archive_object_queue cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_object_type_summary_progress cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_object_type_summary cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_checkpoint_proof_rollup cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_checkpoint_proof cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_state_snapshot cascade'
	);
	await dataSource.query(
		'drop table if exists history_archive_object_host_throttle cascade'
	);
	await dataSource.query(
		'drop function if exists refresh_history_archive_object_type_summary() cascade'
	);
	await dataSource.query(
		'drop function if exists reset_history_archive_object_type_summary() cascade'
	);
}

async function createObjectSummaryFixtureSchema(
	dataSource: DataSource
): Promise<void> {
	await dataSource.query(`
		create table history_archive_object_queue (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"objectKey" text not null,
			status text not null,
			"failureChannel" text,
			"checkpointLedger" integer,
			"bucketHash" text,
			"executionDisposition" text,
			"dependencyReady" boolean,
			"updatedAt" timestamptz not null default now(),
			constraint object_summary_queue_identity
				unique ("archiveUrlIdentity", "objectType", "objectKey"),
			constraint object_summary_queue_status
				check (status in ('pending', 'scanning', 'verified', 'failed'))
		)
	`);
	await dataSource.query(`
		create index object_summary_queue_active_checkpoint
		on history_archive_object_queue (status, "checkpointLedger")
	`);
	await dataSource.query(`
		create table history_archive_state_snapshot (
			"archiveUrl" text not null,
			"archiveUrlIdentity" text primary key,
			"stateUrl" text not null,
			status text not null,
			"observedAt" timestamptz not null,
			source text not null,
			"currentLedger" integer
		)
	`);
	await dataSource.query(`
		create table history_archive_checkpoint_proof (
			id bigserial primary key,
			"archiveUrlIdentity" text not null,
			"checkpointLedger" integer not null,
			status text not null,
			"requiredObjectsComplete" boolean not null
		)
	`);
	await dataSource.query(`
		create table history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity" text primary key,
			"totalCheckpointProofs" bigint not null,
			"pendingCheckpointProofs" bigint not null,
			"verifiedCheckpointProofs" bigint not null,
			"mismatchCheckpointProofs" bigint not null,
			"notEvaluableCheckpointProofs" bigint not null,
			"objectCompleteCheckpointProofs" bigint not null,
			"oldestCheckpointLedger" integer,
			"latestCheckpointLedger" integer
		)
	`);
	await dataSource.query(`
		create table history_archive_object_host_throttle (
			"hostIdentity" text primary key,
			"archiveUrlIdentity" text not null,
			"failureClass" text not null,
			"evidenceClass" text not null,
			"errorType" text not null,
			"httpStatus" integer,
			"blockedUntil" timestamptz not null,
			"lastFailureAt" timestamptz not null,
			"consecutiveFailures" integer not null
		)
	`);
}

async function seedObjectSummaryFixture(dataSource: DataSource): Promise<void> {
	await dataSource.query(
		`insert into history_archive_state_snapshot (
			"archiveUrl", "archiveUrlIdentity", "stateUrl", status,
			"observedAt", source, "currentLedger"
		) values
			($1, $1, $1 || '/.well-known/stellar-history.json', 'available',
				'2026-07-15T10:00:00.000Z', 'network-scan', 127),
			($2, $2, $2 || '/.well-known/stellar-history.json', 'available',
				'2026-07-15T09:00:00.000Z', 'history-scanner', 63)`,
		[archiveA, archiveB]
	);
	await dataSource.query(
		`insert into history_archive_object_queue (
			"archiveUrlIdentity", "objectType", "objectKey", status,
			"failureChannel", "checkpointLedger", "bucketHash",
			"executionDisposition", "dependencyReady"
		) values
			($1, 'history-archive-state', 'root', 'verified', null, null, null,
				'executable', true),
			($1, 'ledger', 'ledger:0000003f', 'verified', null, 63, null,
				'executable', true),
			($1, 'ledger', 'ledger:0000007f', 'failed', null, 127, null,
				'executable', true),
			($1, 'transactions', 'transactions:0000007f', 'scanning', null,
				127, null, 'executable', true),
			($1, 'bucket', 'bucket:' || $3, 'verified', null, null, $3,
				'executable', true),
			($1, 'bucket', 'bucket:' || $4, 'failed', 'archive_evidence',
				null, $4, 'executable', true),
			($2, 'history-archive-state', 'root', 'failed', 'scanner_issue',
				null, null, 'executable', true),
			($2, 'ledger', 'ledger:0000003f', 'pending', null, 63, null,
				'executable', true),
			($2, 'bucket', 'bucket:' || $3, 'pending', null, null, $3,
				'executable', true),
			($2, 'results', 'results:0000003f', 'failed', 'scanner_issue',
				63, null, 'executable', true)`,
		[archiveA, archiveB, bucketHashA, bucketHashB]
	);
	await dataSource.query(
		`insert into history_archive_checkpoint_proof (
			"archiveUrlIdentity", "checkpointLedger", status,
			"requiredObjectsComplete"
		) values
			($1, 63, 'verified', true),
			($1, 127, 'pending', false),
			($2, 63, 'mismatch', true)`,
		[archiveA, archiveB]
	);
	await dataSource.query(
		`insert into history_archive_checkpoint_proof_rollup (
			"archiveUrlIdentity", "totalCheckpointProofs",
			"pendingCheckpointProofs", "verifiedCheckpointProofs",
			"mismatchCheckpointProofs", "notEvaluableCheckpointProofs",
			"objectCompleteCheckpointProofs", "oldestCheckpointLedger",
			"latestCheckpointLedger"
		) values
			($1, 2, 1, 1, 0, 0, 1, 63, 127),
			($2, 1, 0, 0, 1, 0, 1, 63, 63)`,
		[archiveA, archiveB]
	);
}

async function runMigration(
	dataSource: DataSource,
	migration: MigrationInterface
): Promise<void> {
	const runner = dataSource.createQueryRunner();
	await runner.connect();
	try {
		await migration.up(runner);
	} finally {
		await runner.release();
	}
}
