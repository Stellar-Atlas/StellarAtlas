import { MigrationInterface, type QueryRunner } from 'typeorm';
import {
	runArchiveEvidenceSummaryBackfill,
	type ArchiveEvidenceSummaryBackfillObserver
} from '../../repositories/database/HistoryArchiveEvidenceRootSummaryBackfill.js';
import {
	archiveEvidenceSummaryLockTimeoutMs,
	archiveEvidenceSummaryMigrationLockSql,
	archiveEvidenceSummaryMigrationUnlockSql,
	archiveEvidenceSummaryStatementTimeoutMs
} from '../../repositories/database/HistoryArchiveEvidenceRootSummarySql.js';

export class HistoryArchiveEvidenceRootSummaryMigration1784950000000 implements MigrationInterface {
	name = 'HistoryArchiveEvidenceRootSummaryMigration1784950000000';
	transaction = false;
	constructor(
		private readonly backfillObserver: ArchiveEvidenceSummaryBackfillObserver = {}
	) {}

	async up(queryRunner: QueryRunner): Promise<void> {
		await withMigrationLock(queryRunner, async () => {
			await setSessionTimeouts(queryRunner);
			await createSummaryTables(queryRunner);
			await runArchiveEvidenceSummaryBackfill(
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
					drop trigger if exists "trg_history_archive_evidence_root_summary"
					on history_archive_object_queue
				`);
				await queryRunner.query(`
					drop trigger if exists
						"trg_history_archive_evidence_root_summary_truncate"
					on history_archive_object_queue
				`);
				await queryRunner.query(
					'drop function if exists refresh_history_archive_evidence_root_summary()'
				);
				await queryRunner.query(
					'drop function if exists reset_history_archive_evidence_root_summary()'
				);
				await queryRunner.query(
					'drop table if exists history_archive_evidence_root_summary_progress'
				);
				await queryRunner.query(
					'drop table if exists history_archive_evidence_root_summary'
				);
			});
		});
	}
}

async function createSummaryTables(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`
		create table if not exists history_archive_evidence_root_summary (
			"archiveUrlIdentity" text not null,
			"totalObjects" bigint not null default 0,
			"pendingObjects" bigint not null default 0,
			"activeObjects" bigint not null default 0,
			"verifiedObjects" bigint not null default 0,
			"remoteFailureObjects" bigint not null default 0,
			"workerIssueObjects" bigint not null default 0,
			"bucketObjects" bigint not null default 0,
			"verifiedBucketObjects" bigint not null default 0,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_evidence_root_summary"
				primary key ("archiveUrlIdentity"),
			constraint "CHK_history_archive_evidence_root_summary_counts"
				check (
					"totalObjects" >= 0
					and "pendingObjects" between 0 and "totalObjects"
					and "activeObjects" between 0 and "totalObjects"
					and "verifiedObjects" between 0 and "totalObjects"
					and "remoteFailureObjects" between 0 and "totalObjects"
					and "workerIssueObjects" between 0 and "totalObjects"
					and "bucketObjects" between 0 and "totalObjects"
					and "verifiedBucketObjects" between 0 and "bucketObjects"
					and "verifiedBucketObjects" <= "verifiedObjects"
				)
		)
	`);
	await queryRunner.query(`
		create table if not exists history_archive_evidence_root_summary_progress (
			id smallint not null,
			"cutoffObjectId" bigint not null,
			"lastObjectId" bigint not null,
			"complete" boolean not null default false,
			"updatedAt" timestamptz not null default now(),
			constraint "PK_history_archive_evidence_root_summary_progress"
				primary key (id),
			constraint "CHK_history_archive_evidence_root_summary_progress_id"
				check (id = 1),
			constraint "CHK_history_archive_evidence_root_summary_progress_bounds"
				check (
					"cutoffObjectId" >= 0
					and "lastObjectId" >= 0
					and "lastObjectId" <= "cutoffObjectId"
				)
		)
	`);
}

async function withMigrationLock(
	queryRunner: QueryRunner,
	operation: () => Promise<void>
): Promise<void> {
	if (queryRunner.isTransactionActive) {
		throw new Error('Archive evidence summary migration requires mode none');
	}
	const result: unknown = await queryRunner.query(
		archiveEvidenceSummaryMigrationLockSql
	);
	if (!readAcquired(result)) {
		throw new Error('Archive evidence summary migration is already running');
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
			await queryRunner.query(archiveEvidenceSummaryMigrationUnlockSql);
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
		`set lock_timeout = '${archiveEvidenceSummaryLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set statement_timeout = '${archiveEvidenceSummaryStatementTimeoutMs}ms'`
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
