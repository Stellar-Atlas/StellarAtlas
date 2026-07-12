import {
	activeObjectCountSql,
	failureCountSql,
	sourceStatusSummarySql
} from '../HistoryArchiveObjectStatusSummaryQuery.js';
import { checkpointCoverageSql } from '../HistoryArchiveObjectCheckpointCoverageQuery.js';

describe('HistoryArchiveObjectStatusSummaryQuery', () => {
	it('keeps headline queue reads on selective indexed shapes', () => {
		expect(normalize(activeObjectCountSql)).toContain(
			"from history_archive_object_queue where status = 'scanning'"
		);
		expect(normalize(sourceStatusSummarySql)).toContain(
			'from history_archive_object_queue where "objectType" = \'history-archive-state\''
		);
		expect(sourceStatusSummarySql).toContain(
			'join history_archive_checkpoint_proof_rollup proof'
		);
		expect(normalize(sourceStatusSummarySql)).toContain('limit $1');
		expect(normalize(sourceStatusSummarySql)).toContain(
			"where status = 'failed'"
		);
		expect(normalize(failureCountSql)).toContain("where status = 'failed'");
		expect(sourceStatusSummarySql).toContain('"failureChannel"');
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
	});
});

function normalize(value: string): string {
	return value.replaceAll(/\s+/g, ' ').trim();
}
