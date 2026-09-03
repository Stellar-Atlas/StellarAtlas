import type { MigrationInterface, QueryRunner } from 'typeorm';

const statementSummaryFunctionNames = [
	'refresh_history_archive_evidence_root_summary_update_statement',
	'refresh_history_archive_object_type_summary_update_statement'
] as const;

export const historyArchiveStatementSummaryNoopGuard = `
  if not exists (
    select 1
    from old_rows old_row
    join new_rows new_row using (id)
    where old_row."archiveUrlIdentity"
        is distinct from new_row."archiveUrlIdentity"
      or old_row.status is distinct from new_row.status
      or old_row."objectType" is distinct from new_row."objectType"
      or old_row."failureChannel" is distinct from new_row."failureChannel"
  ) then
    return null;
  end if;`;

export function historyArchiveStatementSummaryNoopGuardSql(
	addGuard: boolean
): string {
	const functionNames = statementSummaryFunctionNames
		.map((name) => `'${name}'`)
		.join(', ');
	const mutation = addGuard
		? `
			if position(guard_sql in function_definition) = 0 then
				if position(E'\\nbegin\\n' in function_definition) = 0 then
					raise exception
						'Unable to locate body of archive summary function %()',
						function_name;
				end if;
				function_definition := replace(
					function_definition,
					E'\\nbegin\\n',
					E'\\nbegin\\n' || guard_sql || E'\\n'
				);
				execute function_definition;
			end if;`
		: `
			if position(guard_sql in function_definition) > 0 then
				function_definition := replace(
					function_definition,
					guard_sql || E'\\n',
					''
				);
				execute function_definition;
			end if;`;

	return `
		do $summary_guard$
		declare
			function_name text;
			function_definition text;
			guard_sql text := $guard$${historyArchiveStatementSummaryNoopGuard}$guard$;
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
					raise exception
						'Archive summary function %() is missing',
						function_name;
				end if;
				${mutation}
			end loop;
		end
		$summary_guard$
	`;
}

export class HistoryArchiveStatementSummaryNoopGuardMigration1788170000000 implements MigrationInterface {
	readonly name =
		'HistoryArchiveStatementSummaryNoopGuardMigration1788170000000';

	async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("set local lock_timeout = '10s'");
		await queryRunner.query(historyArchiveStatementSummaryNoopGuardSql(true));
	}

	async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query("set local lock_timeout = '10s'");
		await queryRunner.query(historyArchiveStatementSummaryNoopGuardSql(false));
	}
}
