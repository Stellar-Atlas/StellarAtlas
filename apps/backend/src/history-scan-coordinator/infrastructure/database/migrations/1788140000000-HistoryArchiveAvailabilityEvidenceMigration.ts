import type { MigrationInterface, QueryRunner } from 'typeorm';
import { archiveEvidenceRootSummarySteadyStateTriggerFunctionSql } from '../../repositories/database/HistoryArchiveEvidenceRootSummarySteadyStateSql.js';
import { archiveObjectTypeSummarySteadyStateTriggerFunctionSql } from '../../repositories/database/HistoryArchiveObjectTypeSummarySteadyStateSql.js';

const legacyRepairIndexName = 'idx_history_archive_object_repair_action';
const availabilityRepairIndexName =
	'idx_history_archive_object_repair_action_v2';
const availabilityChannelPredicate =
	"in ('archive_evidence', 'archive_availability')";

export const historyArchiveAvailabilityRepairIndexSql = `
  create index concurrently if not exists
    "${availabilityRepairIndexName}"
  on "history_archive_object_queue" (
    "archiveUrlIdentity",
    "updatedAt" desc,
    "objectOrder",
    "objectKey"
  )
  where status = 'failed'
    and coalesce("failureChannel", 'archive_evidence')
      in ('archive_evidence', 'archive_availability')
    and (
      "httpStatus" in (404, 410)
      or (
        ("httpStatus" is null or "httpStatus" < 400)
        and lower(coalesce("errorMessage", '')) not like '%abort%'
        and (
          replace(lower(coalesce("errorType", '')), '-', '_') like '%not_found%'
          or replace(lower(coalesce("errorType", '')), '-', '_') like '%enoent%'
          or replace(lower(coalesce("errorType", '')), '-', '_') like '%missing%'
          or replace(lower(coalesce("errorType", '')), '-', '_') like '%hash%'
          or replace(lower(coalesce("errorType", '')), '-', '_') like '%mismatch%'
          or replace(lower(coalesce("errorType", '')), '-', '_') in (
            'bucket_verification_failed',
            'category_content_invalid',
            'invalid_checkpoint_state',
            'invalid_history_archive_state'
          )
        )
      )
    )
`;

const legacyRepairIndexSql = historyArchiveAvailabilityRepairIndexSql
	.replace(availabilityRepairIndexName, legacyRepairIndexName)
	.replace(availabilityChannelPredicate, "= 'archive_evidence'");

export class HistoryArchiveAvailabilityEvidenceMigration1788140000000 implements MigrationInterface {
	readonly name = 'HistoryArchiveAvailabilityEvidenceMigration1788140000000';
	readonly transaction = false;

	async up(queryRunner: QueryRunner): Promise<void> {
		await executeConcurrentIndexSql(
			queryRunner,
			historyArchiveAvailabilityRepairIndexSql
		);
		await replaceSummaryFunctionsAndRecount(queryRunner, true);
		await executeConcurrentIndexSql(
			queryRunner,
			`drop index concurrently if exists "${legacyRepairIndexName}"`
		);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await executeConcurrentIndexSql(queryRunner, legacyRepairIndexSql);
		await replaceSummaryFunctionsAndRecount(queryRunner, false);
		await executeConcurrentIndexSql(
			queryRunner,
			`drop index concurrently if exists "${availabilityRepairIndexName}"`
		);
	}
}

async function replaceSummaryFunctionsAndRecount(
	queryRunner: QueryRunner,
	includeAvailability: boolean
): Promise<void> {
	await queryRunner.startTransaction();
	try {
		await queryRunner.query("set local lock_timeout = '10s'");
		await queryRunner.query("set local statement_timeout = '5min'");
		await queryRunner.query(
			'lock table "history_archive_object_queue" in share mode'
		);
		await queryRunner.query(
			summaryFunctionSql(
				archiveEvidenceRootSummarySteadyStateTriggerFunctionSql,
				includeAvailability
			)
		);
		await queryRunner.query(
			summaryFunctionSql(
				archiveObjectTypeSummarySteadyStateTriggerFunctionSql,
				includeAvailability
			)
		);
		await queryRunner.query(`
      create temporary table history_archive_remote_failure_recount
      on commit drop
      as
      select
        "archiveUrlIdentity",
        "objectType",
        count(*)::bigint as count
      from history_archive_object_queue
      where status = 'failed'
        and "failureChannel" ${failureChannelPredicate(includeAvailability)}
      group by "archiveUrlIdentity", "objectType"
    `);
		await queryRunner.query(`
      update history_archive_evidence_root_summary summary
      set
        "remoteFailureObjects" = coalesce((
          select sum(recount.count)
          from history_archive_remote_failure_recount recount
          where recount."archiveUrlIdentity" =
            summary."archiveUrlIdentity"
        ), 0),
        "updatedAt" = now()
    `);
		await queryRunner.query(`
      update history_archive_object_type_summary summary
      set
        "remoteFailureObjects" = coalesce((
          select recount.count
          from history_archive_remote_failure_recount recount
          where recount."archiveUrlIdentity" =
              summary."archiveUrlIdentity"
            and recount."objectType" = summary."objectType"
        ), 0),
        "updatedAt" = now()
    `);
		await queryRunner.commitTransaction();
	} catch (error) {
		if (queryRunner.isTransactionActive) {
			await queryRunner.rollbackTransaction();
		}
		throw error;
	}
}

function summaryFunctionSql(sql: string, includeAvailability: boolean): string {
	return includeAvailability
		? sql
		: sql.replaceAll(availabilityChannelPredicate, "= 'archive_evidence'");
}

function failureChannelPredicate(includeAvailability: boolean): string {
	return includeAvailability
		? availabilityChannelPredicate
		: "= 'archive_evidence'";
}

async function executeConcurrentIndexSql(
	queryRunner: QueryRunner,
	sql: string
): Promise<void> {
	await queryRunner.query("set lock_timeout = '2s'");
	await queryRunner.query("set statement_timeout = '30min'");
	try {
		await queryRunner.query(sql);
	} finally {
		await queryRunner.query('reset lock_timeout');
		await queryRunner.query('reset statement_timeout');
	}
}
