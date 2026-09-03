import type { MigrationInterface, QueryRunner } from 'typeorm';

const statementSummaryFunctionNames = [
	'refresh_history_archive_object_type_summary_insert_statement',
	'refresh_history_archive_object_type_summary_update_statement',
	'refresh_history_archive_evidence_root_summary_insert_statement',
	'refresh_history_archive_evidence_root_summary_update_statement'
] as const;

const evidenceOnlyPredicate = `"failureChannel" = 'archive_evidence'`;
const availabilityPredicate = `"failureChannel" in ('archive_evidence', 'archive_availability')`;

export class HistoryArchiveStatementSummaryAvailabilityCorrectionMigration1788150000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveStatementSummaryAvailabilityCorrectionMigration1788150000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("set local lock_timeout = '10s'");
		await queryRunner.query("set local statement_timeout = '90s'");
		await queryRunner.query(
			historyArchiveStatementSummaryFunctionCorrectionSql(true)
		);
		await recountRemoteFailures(queryRunner, true);
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("set local lock_timeout = '10s'");
		await queryRunner.query("set local statement_timeout = '90s'");
		await queryRunner.query(
			historyArchiveStatementSummaryFunctionCorrectionSql(false)
		);
		await recountRemoteFailures(queryRunner, false);
	}
}

export function historyArchiveStatementSummaryFunctionCorrectionSql(
	includeAvailability: boolean
): string {
	const sourcePredicate = includeAvailability
		? evidenceOnlyPredicate
		: availabilityPredicate;
	const targetPredicate = includeAvailability
		? availabilityPredicate
		: evidenceOnlyPredicate;
	const functionNames = statementSummaryFunctionNames
		.map((name) => quoteSqlLiteral(name))
		.join(', ');

	return `
		do $function_update$
		declare
			function_name text;
			function_definition text;
		begin
			foreach function_name in array array[${functionNames}]
			loop
				select pg_get_functiondef(procedure.oid)
				into function_definition
				from pg_proc procedure
				join pg_namespace namespace
					on namespace.oid = procedure.pronamespace
				where namespace.nspname = 'public'
					and procedure.proname = function_name
					and procedure.pronargs = 0;

				if function_definition is null then
					continue;
				end if;

				function_definition := replace(
					function_definition,
					${quoteSqlLiteral(sourcePredicate)},
					${quoteSqlLiteral(targetPredicate)}
				);
				if position(
					${quoteSqlLiteral(targetPredicate)}
					in function_definition
				) = 0 then
					raise exception
						'Unable to correct archive summary function %()',
						function_name;
				end if;
				execute function_definition;
			end loop;
		end
		$function_update$
	`;
}

async function recountRemoteFailures(
	queryRunner: QueryRunner,
	includeAvailability: boolean
): Promise<void> {
	const predicate = includeAvailability
		? availabilityPredicate
		: evidenceOnlyPredicate;
	await queryRunner.query(`
		create temporary table history_archive_remote_failure_recount_v2
		on commit drop
		as
		select "archiveUrlIdentity", "objectType", count(*)::bigint as count
		from history_archive_object_queue
		where status = 'failed' and ${predicate}
		group by "archiveUrlIdentity", "objectType"
	`);
	await queryRunner.query(`
		with corrected as (
			select summary."archiveUrlIdentity", summary."objectType",
				coalesce(recount.count, 0)::bigint as count
			from history_archive_object_type_summary summary
			left join history_archive_remote_failure_recount_v2 recount
				using ("archiveUrlIdentity", "objectType")
		)
		update history_archive_object_type_summary summary
		set "remoteFailureObjects" = corrected.count, "updatedAt" = now()
		from corrected
		where summary."archiveUrlIdentity" = corrected."archiveUrlIdentity"
			and summary."objectType" = corrected."objectType"
			and summary."remoteFailureObjects" <> corrected.count
	`);
	await queryRunner.query(`
		with corrected as (
			select summary."archiveUrlIdentity",
				coalesce(sum(recount.count), 0)::bigint as count
			from history_archive_evidence_root_summary summary
			left join history_archive_remote_failure_recount_v2 recount
				using ("archiveUrlIdentity")
			group by summary."archiveUrlIdentity"
		)
		update history_archive_evidence_root_summary summary
		set "remoteFailureObjects" = corrected.count, "updatedAt" = now()
		from corrected
		where summary."archiveUrlIdentity" = corrected."archiveUrlIdentity"
			and summary."remoteFailureObjects" <> corrected.count
	`);
}

function quoteSqlLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}
