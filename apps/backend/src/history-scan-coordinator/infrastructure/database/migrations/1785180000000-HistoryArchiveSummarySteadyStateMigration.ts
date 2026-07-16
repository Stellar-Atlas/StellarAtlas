import type { MigrationInterface, QueryRunner } from 'typeorm';
import { archiveEvidenceSummaryTriggerFunctionSql } from '../../repositories/database/HistoryArchiveEvidenceRootSummarySql.js';
import { archiveEvidenceRootSummarySteadyStateTriggerFunctionSql } from '../../repositories/database/HistoryArchiveEvidenceRootSummarySteadyStateSql.js';
import { archiveObjectTypeSummaryTriggerFunctionSql } from '../../repositories/database/HistoryArchiveObjectTypeSummarySql.js';
import { archiveObjectTypeSummarySteadyStateTriggerFunctionSql } from '../../repositories/database/HistoryArchiveObjectTypeSummarySteadyStateSql.js';

const scanningClaimIndexName = 'idx_history_archive_object_scanning_claim';

interface IndexStateRow {
	readonly indisready: boolean;
	readonly indisvalid: boolean;
}

interface SummaryProgressRow {
	readonly caughtUp: boolean;
	readonly complete: boolean;
	readonly summaryName: string;
}

export const historyArchiveScanningClaimIndexSql = `
	create index concurrently if not exists
		"idx_history_archive_object_scanning_claim"
	on "history_archive_object_queue" (
		"claimedAt" asc nulls first,
		id
	)
	include ("remoteId")
	where status = 'scanning'
`;

export class HistoryArchiveSummarySteadyStateMigration1785180000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveSummarySteadyStateMigration1785180000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await assertSummaryBackfillsComplete(queryRunner);
		await setIndexTimeouts(queryRunner);
		try {
			await ensureScanningClaimIndex(queryRunner);
		} finally {
			await resetTimeouts(queryRunner);
		}
		await replaceSummaryFunctions(
			queryRunner,
			archiveEvidenceRootSummarySteadyStateTriggerFunctionSql,
			archiveObjectTypeSummarySteadyStateTriggerFunctionSql
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await replaceSummaryFunctions(
			queryRunner,
			archiveEvidenceSummaryTriggerFunctionSql,
			archiveObjectTypeSummaryTriggerFunctionSql
		);
		await setIndexTimeouts(queryRunner);
		try {
			await queryRunner.query(
				`drop index concurrently if exists "${scanningClaimIndexName}"`
			);
		} finally {
			await resetTimeouts(queryRunner);
		}
	}
}

async function assertSummaryBackfillsComplete(
	queryRunner: QueryRunner
): Promise<void> {
	const result: unknown = await queryRunner.query(`
		select 'archive evidence root' as "summaryName", "complete",
			"lastObjectId" >= "cutoffObjectId" as "caughtUp"
		from history_archive_evidence_root_summary_progress
		where id = 1
		union all
		select 'archive object type' as "summaryName", "complete",
			"lastObjectId" >= "cutoffObjectId" as "caughtUp"
		from history_archive_object_type_summary_progress
		where id = 1
	`);
	if (!Array.isArray(result) || result.length !== 2) {
		throw new Error('Archive summary progress rows are missing');
	}
	for (const value of result) {
		if (!isSummaryProgressRow(value)) {
			throw new Error('Archive summary progress row is invalid');
		}
		if (!value.complete || !value.caughtUp) {
			throw new Error(`${value.summaryName} backfill is incomplete`);
		}
	}
}

async function replaceSummaryFunctions(
	queryRunner: QueryRunner,
	rootFunctionSql: string,
	typeFunctionSql: string
): Promise<void> {
	await queryRunner.startTransaction();
	try {
		await queryRunner.query(`set local lock_timeout = '2s'`);
		await queryRunner.query(`set local statement_timeout = '30s'`);
		await queryRunner.query(
			'select pg_advisory_xact_lock_shared(1784950000, 0)'
		);
		await queryRunner.query(
			'select pg_advisory_xact_lock_shared(1785080000, 0)'
		);
		await assertSummaryBackfillsComplete(queryRunner);
		await queryRunner.query(rootFunctionSql);
		await queryRunner.query(typeFunctionSql);
		await queryRunner.commitTransaction();
	} catch (error) {
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		throw error;
	}
}

async function ensureScanningClaimIndex(
	queryRunner: QueryRunner
): Promise<void> {
	const state = await readIndexState(queryRunner);
	if (state !== null && (!state.indisready || !state.indisvalid)) {
		await queryRunner.query(
			`drop index concurrently if exists "${scanningClaimIndexName}"`
		);
	}
	await queryRunner.query(historyArchiveScanningClaimIndexSql);
}

async function readIndexState(
	queryRunner: QueryRunner
): Promise<IndexStateRow | null> {
	const result: unknown = await queryRunner.query(
		`
			select index_state.indisready, index_state.indisvalid
			from pg_index index_state
			join pg_class index_class
				on index_class.oid = index_state.indexrelid
			join pg_namespace index_namespace
				on index_namespace.oid = index_class.relnamespace
			where index_namespace.nspname = current_schema()
				and index_class.relname = $1
		`,
		[scanningClaimIndexName]
	);
	if (!Array.isArray(result)) {
		throw new Error('Scanning claim index state query did not return rows');
	}
	const row: unknown = result[0];
	if (row === undefined) return null;
	if (!isIndexStateRow(row)) {
		throw new Error('Scanning claim index state query returned invalid data');
	}
	return row;
}

async function setIndexTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query(`set lock_timeout = '2s'`);
	await queryRunner.query(`set statement_timeout = '30min'`);
}

async function resetTimeouts(queryRunner: QueryRunner): Promise<void> {
	await queryRunner.query('reset lock_timeout');
	await queryRunner.query('reset statement_timeout');
}

function isIndexStateRow(value: unknown): value is IndexStateRow {
	if (!isRecord(value)) return false;
	return (
		typeof value.indisready === 'boolean' &&
		typeof value.indisvalid === 'boolean'
	);
}

function isSummaryProgressRow(value: unknown): value is SummaryProgressRow {
	if (!isRecord(value)) return false;
	return (
		typeof value.summaryName === 'string' &&
		typeof value.complete === 'boolean' &&
		typeof value.caughtUp === 'boolean'
	);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
