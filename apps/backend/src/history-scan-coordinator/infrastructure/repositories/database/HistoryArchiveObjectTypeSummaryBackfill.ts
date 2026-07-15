import type { QueryRunner } from 'typeorm';
import {
	archiveObjectTypeSummaryBatchBoundarySql,
	archiveObjectTypeSummaryBatchSize,
	archiveObjectTypeSummaryBatchSql,
	archiveObjectTypeSummaryGlobalExclusiveLockSql,
	archiveObjectTypeSummaryLockTimeoutMs,
	archiveObjectTypeSummaryStatementTimeoutMs,
	archiveObjectTypeSummaryTriggerFunctionSql,
	archiveObjectTypeSummaryTruncateFunctionSql
} from './HistoryArchiveObjectTypeSummarySql.js';

export interface ArchiveObjectTypeSummaryProgress {
	readonly complete: boolean;
	readonly cutoffObjectId: bigint;
	readonly lastObjectId: bigint;
}

export interface ArchiveObjectTypeSummaryBackfillObserver {
	afterBatchCommit?(
		progress: ArchiveObjectTypeSummaryProgress
	): Promise<void> | void;
	beforeBatchCommit?(
		progress: ArchiveObjectTypeSummaryProgress
	): Promise<void> | void;
}

type QueryRow = Readonly<Record<string, unknown>>;
const maximumBackfillBatches = 10_000;

export async function runArchiveObjectTypeSummaryBackfill(
	queryRunner: QueryRunner,
	observer: ArchiveObjectTypeSummaryBackfillObserver = {}
): Promise<void> {
	await initializeArchiveObjectTypeSummary(queryRunner);
	await accumulateInitialRows(queryRunner, observer);
	await markBackfillComplete(queryRunner);
}

async function initializeArchiveObjectTypeSummary(
	queryRunner: QueryRunner
): Promise<void> {
	assertNoOuterTransaction(queryRunner);
	await queryRunner.startTransaction();
	try {
		await setLocalTimeouts(queryRunner);
		await queryRunner.query(`
			lock table history_archive_object_queue
			in share row exclusive mode
		`);
		await queryRunner.query(`
			drop trigger if exists "trg_history_archive_object_type_summary"
			on history_archive_object_queue
		`);
		await queryRunner.query(`
			drop trigger if exists
				"trg_history_archive_object_type_summary_truncate"
			on history_archive_object_queue
		`);
		await queryRunner.query(archiveObjectTypeSummaryTriggerFunctionSql);
		await queryRunner.query(archiveObjectTypeSummaryTruncateFunctionSql);
		const progressRows = await queryRows(
			queryRunner,
			`select id from history_archive_object_type_summary_progress where id = 1`
		);
		if (progressRows.length === 0) {
			await queryRunner.query('truncate history_archive_object_type_summary');
			await queryRunner.query(`
				insert into history_archive_object_type_summary_progress (
					id, "cutoffObjectId", "lastObjectId", "complete",
					"completedAt", "updatedAt"
				)
				select 1, coalesce(max(id), 0), 0, false, null, now()
				from history_archive_object_queue
			`);
		}
		await queryRunner.query(`
			create trigger "trg_history_archive_object_type_summary"
			after insert or delete or update of
				id, "archiveUrlIdentity", "objectType", status, "failureChannel"
			on history_archive_object_queue
			for each row execute function
				refresh_history_archive_object_type_summary()
		`);
		await queryRunner.query(`
			create trigger "trg_history_archive_object_type_summary_truncate"
			after truncate on history_archive_object_queue
			for each statement execute function
				reset_history_archive_object_type_summary()
		`);
		await queryRunner.commitTransaction();
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function accumulateInitialRows(
	queryRunner: QueryRunner,
	observer: ArchiveObjectTypeSummaryBackfillObserver
): Promise<void> {
	for (let batch = 0; batch < maximumBackfillBatches; batch++) {
		const progress = await readProgress(queryRunner);
		if (isFinished(progress)) return;

		const next = await inTransaction(queryRunner, async () => {
			await queryRunner.query(`
				lock table history_archive_object_queue in access share mode
			`);
			await queryRunner.query(archiveObjectTypeSummaryGlobalExclusiveLockSql);
			const lockedProgress = await readProgress(queryRunner);
			if (isFinished(lockedProgress)) return lockedProgress;

			const batchEndObjectId = await readBatchEndObjectId(
				queryRunner,
				lockedProgress
			);
			const result = await queryRows(
				queryRunner,
				archiveObjectTypeSummaryBatchSql,
				[
					lockedProgress.lastObjectId.toString(),
					batchEndObjectId.toString(),
					archiveObjectTypeSummaryBatchSize
				]
			);
			const committed = parseProgress(result[0]);
			await observer.beforeBatchCommit?.(committed);
			return committed;
		});

		await observer.afterBatchCommit?.(next);
		if (isFinished(next)) return;
		if (next.lastObjectId <= progress.lastObjectId) {
			throw new Error('Archive object type summary backfill made no progress');
		}
	}

	throw new Error('Archive object type summary exceeded its batch limit');
}

function isFinished(progress: ArchiveObjectTypeSummaryProgress): boolean {
	return progress.complete || progress.lastObjectId >= progress.cutoffObjectId;
}

async function readBatchEndObjectId(
	queryRunner: QueryRunner,
	progress: ArchiveObjectTypeSummaryProgress
): Promise<bigint> {
	const result = await queryRows(
		queryRunner,
		archiveObjectTypeSummaryBatchBoundarySql,
		[
			progress.lastObjectId.toString(),
			progress.cutoffObjectId.toString(),
			archiveObjectTypeSummaryBatchSize
		]
	);
	return BigInt(requireString(result[0], 'batchEndObjectId'));
}

async function markBackfillComplete(queryRunner: QueryRunner): Promise<void> {
	await inTransaction(queryRunner, async () => {
		await queryRunner.query(archiveObjectTypeSummaryGlobalExclusiveLockSql);
		const progress = await readProgress(queryRunner);
		if (progress.complete) return;
		if (progress.lastObjectId < progress.cutoffObjectId) {
			throw new Error('Archive object type summary backfill is incomplete');
		}
		await queryRunner.query(`
			update history_archive_object_type_summary_progress
			set "complete" = true, "completedAt" = now(), "updatedAt" = now()
			where id = 1
		`);
	});
}

async function readProgress(
	queryRunner: QueryRunner
): Promise<ArchiveObjectTypeSummaryProgress> {
	const result = await queryRows(
		queryRunner,
		`
			select "complete", "cutoffObjectId"::text as "cutoffObjectId",
				"lastObjectId"::text as "lastObjectId"
			from history_archive_object_type_summary_progress
			where id = 1
		`
	);
	return parseProgress(result[0]);
}

function parseProgress(
	row: QueryRow | undefined
): ArchiveObjectTypeSummaryProgress {
	return {
		complete: row?.complete === true,
		cutoffObjectId: BigInt(requireString(row, 'cutoffObjectId')),
		lastObjectId: BigInt(requireString(row, 'lastObjectId'))
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
		`set local lock_timeout = '${archiveObjectTypeSummaryLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set local statement_timeout = '${archiveObjectTypeSummaryStatementTimeoutMs}ms'`
	);
}

async function queryRows(
	queryRunner: QueryRunner,
	sql: string,
	parameters: readonly unknown[] = []
): Promise<readonly QueryRow[]> {
	const value: unknown = await queryRunner.query(sql, [...parameters]);
	if (!Array.isArray(value)) throw new Error('Expected database rows');
	const values: unknown[] = value;
	const rows: QueryRow[] = [];
	for (const item of values) {
		if (!isQueryRow(item)) throw new Error('Expected a database row object');
		rows.push(item);
	}
	return rows;
}

function isQueryRow(value: unknown): value is QueryRow {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(row: QueryRow | undefined, field: string): string {
	const value = row?.[field];
	if (typeof value === 'string') return value;
	throw new Error(`Archive object type summary row is missing ${field}`);
}

function assertNoOuterTransaction(queryRunner: QueryRunner): void {
	if (queryRunner.isTransactionActive) {
		throw new Error(
			'Archive object type summary requires transaction mode none'
		);
	}
}

async function rollback(queryRunner: QueryRunner): Promise<void> {
	if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
}
