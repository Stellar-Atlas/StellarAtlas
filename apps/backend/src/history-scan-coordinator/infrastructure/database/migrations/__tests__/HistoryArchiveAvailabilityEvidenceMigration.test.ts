import { historyArchiveAvailabilityRepairIndexSql } from '../1788140000000-HistoryArchiveAvailabilityEvidenceMigration.js';
import { archiveEvidenceRootSummarySteadyStateTriggerFunctionSql } from '../../../repositories/database/HistoryArchiveEvidenceRootSummarySteadyStateSql.js';
import { archiveObjectTypeSummarySteadyStateTriggerFunctionSql } from '../../../repositories/database/HistoryArchiveObjectTypeSummarySteadyStateSql.js';

describe('history archive availability evidence migration', () => {
	it('counts archive availability as remote archive evidence', () => {
		for (const sql of [
			archiveEvidenceRootSummarySteadyStateTriggerFunctionSql,
			archiveObjectTypeSummarySteadyStateTriggerFunctionSql
		]) {
			expect(sql).toContain("in ('archive_evidence', 'archive_availability')");
		}
	});

	it('indexes repairable availability failures', () => {
		expect(historyArchiveAvailabilityRepairIndexSql).toContain(
			'idx_history_archive_object_repair_action_v2'
		);
		expect(historyArchiveAvailabilityRepairIndexSql).toContain(
			"in ('archive_evidence', 'archive_availability')"
		);
		expect(historyArchiveAvailabilityRepairIndexSql).toContain(
			'"httpStatus" in (404, 410)'
		);
	});
});
