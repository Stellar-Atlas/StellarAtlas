import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
	runArchiveObjectTypeSummaryBackfill,
	type ArchiveObjectTypeSummaryBackfillObserver
} from '../../repositories/database/HistoryArchiveObjectTypeSummaryBackfill.js';
import {
	archiveObjectTypeSummaryLockTimeoutMs,
	archiveObjectTypeSummaryMigrationLockSql,
	archiveObjectTypeSummaryMigrationUnlockSql,
	archiveObjectTypeSummaryStatementTimeoutMs
} from '../../repositories/database/HistoryArchiveObjectTypeSummarySql.js';

export class HistoryArchiveObjectTypeSummaryMigration1785080000000 implements MigrationInterface {
	name = 'HistoryArchiveObjectTypeSummaryMigration1785080000000';
	transaction = false;

	constructor(
		private readonly backfillObserver: ArchiveObjectTypeSummaryBackfillObserver = {}
	) {}

	async up(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await setSessionTimeouts(queryRunner);
			await createSummaryTables(queryRunner);
			await runArchiveObjectTypeSummaryBackfill(
				queryRunner,
				this.backfillObserver
			);
		});
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await setSessionTimeouts(queryRunner);
			await runInTransaction(queryRunner, async () => {
				await queryRunner.query(`
					drop trigger if exists
						"trg_history_archive_object_type_summary"
					on history_archive_object_queue
				`);
				await queryRunner.query(`
					drop trigger if exists
						"trg_history_archive_object_type_summary_truncate"
					on history_archive_object_queue
				`);
				await queryRunner.query(`
					drop function if exists
						refresh_history_archive_object_type_summary()
				`);
				await queryRunner.query(`
					drop function if exists
						reset_history_archive_object_type_summary()
				`);
				await queryRunner.query(`
					drop table if exists
						history_archive_object_type_summary_progress
				`);
				await queryRunner.query(`
					drop table if exists history_archive_object_type_summary
				`);
			});
		});
	}
}

async function createSummaryTables(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		create table if not exists history_archive_object_type_summary (
			"archiveUrlIdentity" text not null,
			"objectType" text not null,
			"totalObjects" bigint not null default 0,
			"pendingObjects" bigint not null default 0,
			"scanningObjects" bigint not null default 0,
			"verifiedObjects" bigint not null default 0,
			"remoteFailureObjects" bigint not null default 0,
			"scannerIssueObjects" bigint not null default 0,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_object_type_summary"
				primary key ("archiveUrlIdentity", "objectType"),
			constraint "CHK_history_archive_object_type_summary_counts"
				check (
					"totalObjects" >= 0
					and "pendingObjects" between 0 and "totalObjects"
					and "scanningObjects" between 0 and "totalObjects"
					and "verifiedObjects" between 0 and "totalObjects"
					and "remoteFailureObjects" between 0 and "totalObjects"
					and "scannerIssueObjects" between 0 and "totalObjects"
					and "pendingObjects" + "scanningObjects"
						+ "verifiedObjects" + "remoteFailureObjects"
						+ "scannerIssueObjects" <= "totalObjects"
				)
		)
	`);
	await queryRunner.query(`
		create table if not exists history_archive_object_type_summary_progress (
			id smallint not null,
			"cutoffObjectId" bigint not null,
			"lastObjectId" bigint not null,
			"complete" boolean not null default false,
			"completedAt" timestamptz,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_object_type_summary_progress"
				primary key (id),
			constraint "CHK_history_archive_object_type_summary_progress_id"
				check (id = 1),
			constraint "CHK_history_archive_object_type_summary_progress_bounds"
				check (
					"cutoffObjectId" >= 0
					and "lastObjectId" >= 0
					and "lastObjectId" <= "cutoffObjectId"
				),
			constraint "CHK_history_archive_object_type_summary_progress_complete"
				check (
					("complete" = false and "completedAt" is null)
					or ("complete" = true and "completedAt" is not null)
				)
		)
	`);
}

async function withMigrationLock(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	if (queryRunner.isTransactionActive) {
		throw new Error('Archive object type summary migration requires mode none');
	}
	const result: unknown = await queryRunner.query(
		archiveObjectTypeSummaryMigrationLockSql
	);
	if (!readAcquired(result)) {
		throw new Error('Archive object type summary migration is already running');
	}
	try {
		await operation();
	} finally {
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		try {
			await queryRunner.query('reset lock_timeout');
			await queryRunner.query('reset statement_timeout');
		} finally {
			await queryRunner.query(archiveObjectTypeSummaryMigrationUnlockSql);
		}
	}
}

function readAcquired(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	const values: unknown[] = value;
	const first = values[0];
	return (
		typeof first === 'object' &&
		first !== null &&
		'acquired' in first &&
		first.acquired === true
	);
}

async function setSessionTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(
		`set lock_timeout = '${archiveObjectTypeSummaryLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set statement_timeout = '${archiveObjectTypeSummaryStatementTimeoutMs}ms'`
	);
}

async function runInTransaction(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	await queryRunner.startTransaction();
	try {
		await operation();
		await queryRunner.commitTransaction();
	} catch (error) {
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		throw error;
	}
}
