import { historyArchiveStatementSummaryFunctionCorrectionSql } from '../1788150000000-HistoryArchiveStatementSummaryAvailabilityCorrectionMigration.js';

describe('history archive statement summary availability correction', () => {
	it('adds archive availability to every statement summary function', () => {
		const sql = historyArchiveStatementSummaryFunctionCorrectionSql(true);

		expect(sql).toContain("''archive_evidence'', ''archive_availability''");
		expect(sql).toContain(
			'refresh_history_archive_object_type_summary_insert_statement'
		);
		expect(sql).toContain(
			'refresh_history_archive_object_type_summary_update_statement'
		);
		expect(sql).toContain(
			'refresh_history_archive_evidence_root_summary_insert_statement'
		);
		expect(sql).toContain(
			'refresh_history_archive_evidence_root_summary_update_statement'
		);
	});

	it('restores the evidence-only predicate on rollback', () => {
		const sql = historyArchiveStatementSummaryFunctionCorrectionSql(false);
		expect(sql).toContain(`"failureChannel" = ''archive_evidence''`);
	});
});
