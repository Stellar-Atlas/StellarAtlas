import {
	historyArchiveStatementSummaryNoopGuard,
	historyArchiveStatementSummaryNoopGuardSql
} from '../1788170000000-HistoryArchiveStatementSummaryNoopGuardMigration.js';

describe('HistoryArchiveStatementSummaryNoopGuardMigration', () => {
	it('skips summary locks when an update changes no summarized field', () => {
		expect(historyArchiveStatementSummaryNoopGuard).toContain(
			'old_row.status is distinct from new_row.status'
		);
		expect(historyArchiveStatementSummaryNoopGuard).toContain(
			'old_row."failureChannel" is distinct from new_row."failureChannel"'
		);

		const sql = historyArchiveStatementSummaryNoopGuardSql(true);
		expect(sql).toContain(
			'refresh_history_archive_evidence_root_summary_update_statement'
		);
		expect(sql).toContain(
			'refresh_history_archive_object_type_summary_update_statement'
		);
		expect(sql).toContain("position(E'\\nbegin\\n' in function_definition)");
		expect(sql).toContain("E'\\nbegin\\n' || guard_sql || E'\\n'");
	});

	it('removes only the installed guard on rollback', () => {
		const sql = historyArchiveStatementSummaryNoopGuardSql(false);
		expect(sql).toContain("guard_sql || E'\\n'");
		expect(sql).toContain("''");
	});
});
