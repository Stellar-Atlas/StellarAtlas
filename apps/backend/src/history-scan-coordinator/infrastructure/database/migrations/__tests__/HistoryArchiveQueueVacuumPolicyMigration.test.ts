import {
	historyArchiveQueueVacuumPolicyResetSql,
	historyArchiveQueueVacuumPolicySql
} from '../1788160000000-HistoryArchiveQueueVacuumPolicyMigration.js';

describe('history archive queue vacuum policy', () => {
	it('raises the queue vacuum trigger above ordinary completion churn', () => {
		expect(historyArchiveQueueVacuumPolicySql).toContain(
			'autovacuum_vacuum_scale_factor = 0.05'
		);
		expect(historyArchiveQueueVacuumPolicySql).toContain(
			'autovacuum_vacuum_threshold = 100000'
		);
	});

	it('restores inherited settings on rollback', () => {
		expect(historyArchiveQueueVacuumPolicyResetSql).toContain(
			'autovacuum_vacuum_scale_factor'
		);
		expect(historyArchiveQueueVacuumPolicyResetSql).toContain(
			'autovacuum_vacuum_threshold'
		);
	});
});
