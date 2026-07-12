import type { QueryRunner } from 'typeorm';
import {
	archiveEvidenceSummaryBatchBoundarySql,
	archiveEvidenceSummaryBatchSize,
	archiveEvidenceSummaryBatchSql,
	archiveEvidenceSummaryGlobalExclusiveLockSql,
	archiveEvidenceSummaryLockTimeoutMs,
	archiveEvidenceSummaryStatementTimeoutMs,
	archiveEvidenceSummaryTriggerFunctionSql,
	archiveEvidenceSummaryTruncateFunctionSql
} from './HistoryArchiveEvidenceRootSummarySql.js';

interface Progress {
	readonly complete: boolean;
	readonly cutoffObjectId: bigint;
	readonly lastObjectId: bigint;
}

type QueryRow = Readonly<Record<string, unknown>>;
const maximumInitialBatches = 10_000;

export interface ArchiveEvidenceSummaryBackfillObserver {
	afterInitialBatch?(progress: Progress): Promise<void> | void;
	beforeInitialBatchCommit?(progress: Progress): Promise<void> | void;
}

export async function runArchiveEvidenceSummaryBackfill(
	queryRunner: QueryRunner,
	observer: ArchiveEvidenceSummaryBackfillObserver = {}
): Promise<void> {
	await initializeArchiveEvidenceSummary(queryRunner);
	await accumulateInitialObjectRows(queryRunner, observer);
	await markBackfillComplete(queryRunner);
}

async function initializeArchiveEvidenceSummary(
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
			drop trigger if exists "trg_history_archive_evidence_root_summary"
			on history_archive_object_queue
		`);
		await queryRunner.query(`
			drop trigger if exists "trg_history_archive_evidence_root_summary_truncate"
			on history_archive_object_queue
		`);
		await queryRunner.query(archiveEvidenceSummaryTriggerFunctionSql);
		await queryRunner.query(archiveEvidenceSummaryTruncateFunctionSql);
		const progressRows = await queryRows(
			queryRunner,
			`select id from history_archive_evidence_root_summary_progress where id = 1`
		);
		if (progressRows.length === 0) {
			await queryRunner.query('truncate history_archive_evidence_root_summary');
			await queryRunner.query(`
				insert into history_archive_evidence_root_summary_progress (
					id, "cutoffObjectId", "lastObjectId", "complete", "updatedAt"
				)
				select 1, coalesce(max(id), 0), 0, false, now()
				from history_archive_object_queue
			`);
		}
		await queryRunner.query(`
			create trigger "trg_history_archive_evidence_root_summary"
			after insert or delete or update of
				id, "archiveUrlIdentity", status, "objectType", "failureChannel"
			on history_archive_object_queue
			for each row execute function
				refresh_history_archive_evidence_root_summary()
		`);
		await queryRunner.query(`
			create trigger "trg_history_archive_evidence_root_summary_truncate"
			after truncate on history_archive_object_queue
			for each statement execute function
				reset_history_archive_evidence_root_summary()
		`);
		await queryRunner.commitTransaction();
	} catch (error) {
		await rollback(queryRunner);
		throw error;
	}
}

async function accumulateInitialObjectRows(
	queryRunner: QueryRunner,
	observer: ArchiveEvidenceSummaryBackfillObserver
): Promise<void> {
	for (let batch = 0; batch < maximumInitialBatches; batch++) {
		const progress = await readProgress(queryRunner);
		if (progress.complete || progress.lastObjectId >= progress.cutoffObjectId) {
			return;
		}

		const next = await inTransaction(queryRunner, async () => {
			await queryRunner.query(`
				lock table history_archive_object_queue in access share mode
			`);
			await queryRunner.query(archiveEvidenceSummaryGlobalExclusiveLockSql);
			const lockedProgress = await readProgress(queryRunner);
			if (
				lockedProgress.complete ||
				lockedProgress.lastObjectId >= lockedProgress.cutoffObjectId
			) {
				return lockedProgress;
			}
			const batchEndObjectId = await readBatchEndObjectId(
				queryRunner,
				lockedProgress
			);
			const rows = await queryRows(
				queryRunner,
				archiveEvidenceSummaryBatchSql,
				[
					lockedProgress.lastObjectId.toString(),
					batchEndObjectId.toString(),
					archiveEvidenceSummaryBatchSize
				]
			);
			const committed = parseProgress(rows[0]);
			await observer.beforeInitialBatchCommit?.(committed);
			return committed;
		});
		if (next.complete || next.lastObjectId >= next.cutoffObjectId) {
			await observer.afterInitialBatch?.(next);
			return;
		}
		if (next.lastObjectId <= progress.lastObjectId) {
			throw new Error('Archive evidence summary backfill made no progress');
		}
		await observer.afterInitialBatch?.(next);
	}

	throw new Error('Archive evidence summary exceeded its bounded batch limit');
}

async function readBatchEndObjectId(
	queryRunner: QueryRunner,
	progress: Progress
): Promise<bigint> {
	const rows = await queryRows(
		queryRunner,
		archiveEvidenceSummaryBatchBoundarySql,
		[
			progress.lastObjectId.toString(),
			progress.cutoffObjectId.toString(),
			archiveEvidenceSummaryBatchSize
		]
	);
	return BigInt(requireString(rows[0], 'batchEndObjectId'));
}

async function markBackfillComplete(queryRunner: QueryRunner): Promise<void> {
	await inTransaction(queryRunner, async () => {
		await queryRunner.query(archiveEvidenceSummaryGlobalExclusiveLockSql);
		const progress = await readProgress(queryRunner);
		if (progress.complete) return;
		if (progress.lastObjectId < progress.cutoffObjectId) {
			throw new Error('Archive evidence summary backfill is incomplete');
		}
		await queryRunner.query(`
			update history_archive_evidence_root_summary_progress
			set "complete" = true, "updatedAt" = now()
			where id = 1
		`);
	});
}

async function readProgress(queryRunner: QueryRunner): Promise<Progress> {
	const rows = await queryRows(
		queryRunner,
		`
		select "complete", "cutoffObjectId"::text as "cutoffObjectId",
			"lastObjectId"::text as "lastObjectId"
		from history_archive_evidence_root_summary_progress
		where id = 1
	`
	);
	return parseProgress(rows[0]);
}

function parseProgress(row: QueryRow | undefined): Progress {
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
		`set local lock_timeout = '${archiveEvidenceSummaryLockTimeoutMs}ms'`
	);
	await queryRunner.query(
		`set local statement_timeout = '${archiveEvidenceSummaryStatementTimeoutMs}ms'`
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
		if (!isQueryRow(item)) {
			throw new Error('Expected a database row object');
		}
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
	throw new Error(`Archive evidence summary row is missing ${field}`);
}

function assertNoOuterTransaction(queryRunner: QueryRunner): void {
	if (queryRunner.isTransactionActive) {
		throw new Error('Archive evidence summary requires transaction mode none');
	}
}

async function rollback(queryRunner: QueryRunner): Promise<void> {
	if (queryRunner.isTransactionActive) await queryRunner.rollbackTransaction();
}
