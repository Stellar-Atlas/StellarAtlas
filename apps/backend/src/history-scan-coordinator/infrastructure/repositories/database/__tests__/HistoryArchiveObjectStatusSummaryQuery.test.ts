import {
	evidenceHealthSql,
	sourceStatusSummarySql
} from '../HistoryArchiveObjectStatusSummaryQuery.js';
import { checkpointCoverageSql } from '../HistoryArchiveObjectCheckpointCoverageQuery.js';

describe('HistoryArchiveObjectStatusSummaryQuery', () => {
	it('keeps headline queue reads on selective indexed shapes', () => {
		const currentHealthSql = [
			evidenceHealthSql,
			sourceStatusSummarySql,
			checkpointCoverageSql
		].join('\n');

		expect(evidenceHealthSql).toContain(
			'from history_archive_evidence_root_summary_progress'
		);
		expect(evidenceHealthSql).toContain(
			'left join history_archive_evidence_root_summary summary'
		);
		expect(normalize(sourceStatusSummarySql)).toContain(
			'from history_archive_object_queue where "objectType" = \'history-archive-state\''
		);
		expect(sourceStatusSummarySql).toContain(
			'join history_archive_checkpoint_proof_rollup proof'
		);
		expect(normalize(sourceStatusSummarySql)).toContain('limit $1');
		expect(sourceStatusSummarySql).toContain(
			'left join history_archive_evidence_root_summary summary'
		);
		expect(sourceStatusSummarySql).not.toContain('failure_counts_by_identity');
		expect(sourceStatusSummarySql).not.toMatch(
			/from\s+"?history_archive_checkpoint_proof"?\s/i
		);
		expect(checkpointCoverageSql).toContain(
			'from history_archive_checkpoint_proof_rollup'
		);
		expect(checkpointCoverageSql).not.toMatch(/count\s*\(\s*distinct/i);
		expect(checkpointCoverageSql).not.toMatch(
			/from\s+"?history_archive_checkpoint_proof"?\s/i
		);
		expect(checkpointCoverageSql).toContain('active_checkpoints as');
		expect(normalize(checkpointCoverageSql)).toContain(
			'status = \'scanning\' and "checkpointLedger" is not null'
		);
		expect(currentHealthSql).not.toMatch(
			/history_archive_scan_v2|history_archive_scan_job|history_archive_scan_evidence/
		);
	});
});

function normalize(value: string): string {
	return value.replaceAll(/\s+/g, ' ').trim();
}
