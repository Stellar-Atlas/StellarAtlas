import type { QueryRunner } from 'typeorm';
import {
	archiveBucketReferenceSummaryBatchBoundarySql,
	archiveBucketReferenceSummaryBatchSize,
	archiveBucketReferenceSummaryBatchSql,
	archiveBucketReferenceSummaryGlobalExclusiveLockSql,
	archiveBucketReferenceSummaryLockTimeoutMs,
	archiveBucketReferenceSummaryStatementTimeoutMs,
	archiveBucketReferenceSummaryTriggerFunctionSql,
	archiveBucketReferenceSummaryTruncateFunctionSql
} from './HistoryArchiveBucketReferenceSummarySql.js';

export interface ArchiveBucketReferenceSummaryProgress {
	readonly complete: boolean;
	readonly cutoffBucketHash: string;
	readonly lastBucketHash: string;
}

export interface ArchiveBucketReferenceSummaryBackfillObserver {
	afterBatchCommit?(
		progress: ArchiveBucketReferenceSummaryProgress
	): Promise<void> | void;
	beforeBatchCommit?(
		progress: ArchiveBucketReferenceSummaryProgress
	): Promise<void> | void;
}

type QueryRow = Readonly<Record<string, unknown>>;
const maximumBackfillBatches = 10_000;

export async function runArchiveBucketReferenceSummaryBackfill(
	queryRunner: QueryRunner,
	observer: ArchiveBucketReferenceSummaryBackfillObserver = {}
): Promise<void> {
	await initialize(queryRunner);
	await accumulate(queryRunner, observer);
	await markComplete(queryRunner);
}

async function initialize(queryRunner: QueryRunner): Promise<void> {
	assertNoOuterTransaction(queryRunner);
	await queryRunner.startTransaction();
	try {
		await setLocalTimeouts(queryRunner);
		await queryRunner.query(`
			lock table history_archive_object_queue in share row exclusive mode
		`);
		await queryRunner.query(`
			drop trigger if exists "trg_history_archive_bucket_reference_summary"
			on history_archive_object_queue
		`);
		await queryRunner.query(`
			drop trigger if exists
				"trg_history_archive_bucket_reference_summary_truncate"
			on history_archive_object_queue
		`);
		await queryRunner.query(archiveBucketReferenceSummaryTriggerFunctionSql);
		await queryRunner.query(archiveBucketReferenceSummaryTruncateFunctionSql);
		const progress = await rows(
			queryRunner,
			`select id from history_archive_bucket_reference_summary_progress
			 where id = 1`
		);
		if (progress.length === 0) await initializeProgress(queryRunner);
		await queryRunner.query(`
			create trigger "trg_history_archive_bucket_reference_summary"
			after insert or delete or update of
				"archiveUrlIdentity", "objectType", "bucketHash"
			on history_archive_object_queue
			for each row execute function
				refresh_history_archive_bucket_reference_summary()
		`);
		await queryRunner.query(`
			create trigger "trg_history_archive_bucket_reference_summary_truncate"
			after truncate on history_archive_object_queue
			for each statement execute function
				reset_history_archive_bucket_reference_summary()
		`);
		await queryRunner.commitTransaction();
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function initializeProgress(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query('truncate history_archive_bucket_reference_summary');
	await queryRunner.query('truncate history_archive_bucket_identity_summary');
	await queryRunner.query(`
		insert into history_archive_bucket_reference_summary_progress (
			id, "cutoffBucketHash", "lastBucketHash", "complete",
			"completedAt", "updatedAt"
		)
		select 1, cutoff, '', cutoff = '',
			case when cutoff = '' then now() else null end, now()
		from (
			select coalesce(max("bucketHash"), '') as cutoff
			from history_archive_object_queue
			where "objectType" = 'bucket' and "bucketHash" is not null
		) current_cutoff
	`);
}

async function accumulate(
	queryRunner: QueryRunner,
	observer: ArchiveBucketReferenceSummaryBackfillObserver
): Promise<void> {
	for (let batch = 0; batch < maximumBackfillBatches; batch++) {
		const progress = await readProgress(queryRunner);
		if (isFinished(progress)) return;
		const next = await inTransaction(queryRunner, async () => {
			await queryRunner.query(
				archiveBucketReferenceSummaryGlobalExclusiveLockSql
			);
			const locked = await readProgress(queryRunner);
			if (isFinished(locked)) return locked;
			const batchEnd = await readBatchEnd(queryRunner, locked);
			const result = await rows(
				queryRunner,
				archiveBucketReferenceSummaryBatchSql,
				[locked.lastBucketHash, batchEnd]
			);
			const committed = parseProgress(result[0]);
			await observer.beforeBatchCommit?.(committed);
			return committed;
		});
		await observer.afterBatchCommit?.(next);
		if (isFinished(next)) return;
		if (next.lastBucketHash <= progress.lastBucketHash) {
			throw new Error('Archive bucket reference backfill made no progress');
		}
	}
	throw new Error('Archive bucket reference backfill exceeded its batch limit');
}

async function readBatchEnd(
	queryRunner: QueryRunner,
	progress: ArchiveBucketReferenceSummaryProgress
): Promise<string> {
	const result = await rows(
		queryRunner,
		archiveBucketReferenceSummaryBatchBoundarySql,
		[
			progress.lastBucketHash,
			progress.cutoffBucketHash,
			archiveBucketReferenceSummaryBatchSize
		]
	);
	return requireString(result[0], 'batchEndBucketHash');
}

async function markComplete(queryRunner: QueryRunner): Promise<void> {
	await inTransaction(queryRunner, async () => {
		await queryRunner.query(archiveBucketReferenceSummaryGlobalExclusiveLockSql);
		const progress = await readProgress(queryRunner);
		if (progress.complete) return;
		if (!isFinished(progress)) {
			throw new Error('Archive bucket reference backfill is incomplete');
		}
		await assertReferenceTotals(queryRunner);
		await queryRunner.query(`
			update history_archive_bucket_reference_summary_progress
			set "complete" = true, "completedAt" = now(), "updatedAt" = now()
			where id = 1
		`);
	});
}

async function assertReferenceTotals(queryRunner: QueryRunner): Promise<void> {
	const result = await rows(queryRunner, `
		select
			coalesce((select sum("referenceCount")
				from history_archive_bucket_identity_summary), 0)::text
				as "globalReferences",
			coalesce((select sum("referenceCount")
				from history_archive_bucket_reference_summary), 0)::text
				as "sourceReferences",
			coalesce((select sum("totalObjects")
				from history_archive_object_type_summary
				where "objectType" = 'bucket'), 0)::text as "queueReferences",
			coalesce((select "complete"
				from history_archive_object_type_summary_progress where id = 1), false)
				as "typeSummaryReady"
	`);
	const row = result[0];
	const globalReferences = requireString(row, 'globalReferences');
	const sourceReferences = requireString(row, 'sourceReferences');
	const queueReferences = requireString(row, 'queueReferences');
	if (
		row?.typeSummaryReady !== true ||
		globalReferences !== sourceReferences ||
		globalReferences !== queueReferences
	) {
		throw new Error('Archive bucket reference totals do not reconcile');
	}
}

function isFinished(progress: ArchiveBucketReferenceSummaryProgress): boolean {
	return (
		progress.complete ||
		progress.lastBucketHash >= progress.cutoffBucketHash
	);
}

async function readProgress(
	queryRunner: QueryRunner
): Promise<ArchiveBucketReferenceSummaryProgress> {
	const result = await rows(
		queryRunner,
		`select "complete", "cutoffBucketHash", "lastBucketHash"
		 from history_archive_bucket_reference_summary_progress where id = 1`
	);
	return parseProgress(result[0]);
}

function parseProgress(
	row: QueryRow | undefined
): ArchiveBucketReferenceSummaryProgress {
	return {
		complete: row?.complete === true,
		cutoffBucketHash: requireString(row, 'cutoffBucketHash'),
		lastBucketHash: requireString(row, 'lastBucketHash')
	};
}

async function inTransaction<T>(
	queryRunner: QueryRunner,
	operation: () => Promise<T>
): Promise<T> {
	assertNoOuterTransaction(queryRunner);
	await queryRunner.startTransaction();
	try {
		await setLocalTimeouts(queryRunner);
		const result = await operation();
		await queryRunner.commitTransaction();
		return result;
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function setLocalTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(
		`set local lock_timeout = '${archiveBucketReferenceSummaryLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set local statement_timeout = '${archiveBucketReferenceSummaryStatementTimeoutMs}ms'`
	);
}

async function rows(
	queryRunner: QueryRunner,
	sql: string,
	parameters: readonly unknown[] = []
): Promise<readonly QueryRow[]> {
	const value: unknown = await queryRunner.query(sql, [...parameters]);
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	const result: QueryRow[] = [];
	for (const item of value) {
		if (typeof item !== 'object' || item === null || Array.isArray(item)) {
			throw new Error('Expected a database row object');
		}
		result.push(item as QueryRow);
	}
	return result;
}

function requireString(row: QueryRow | undefined, field: string): string {
	const value = row?.[field];
	if (typeof value === 'string') return value;
	throw new Error(`Archive bucket reference row is missing ${field}`);
}

function assertNoOuterTransaction(queryRunner: QueryRunner): void {
	if (queryRunner.isTransactionActive) {
		throw new Error('Archive bucket reference backfill requires mode none');
	}
}

async function rollback(queryRunner: QueryRunner): Promise<void> {
	if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
}
