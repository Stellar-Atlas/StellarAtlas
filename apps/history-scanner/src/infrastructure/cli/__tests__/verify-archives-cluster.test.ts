import { createHistoryScanClusterPlan } from '../verify-archives-cluster.js';

describe('verify-archives-cluster', () => {
	it('defaults to 12 process workers on this class of host without multiplying caps', () => {
		const plan = createHistoryScanClusterPlan({}, 48);

		expect(plan).toEqual({
			perProcessHasherWorkers: 1,
			perProcessRequests: 1,
			processCount: 12,
			totalHasherWorkers: 12,
			totalRequests: 12
		});
	});

	it('bounds process workers by the total request and hasher budgets', () => {
		const plan = createHistoryScanClusterPlan(
			{
				HISTORY_HASHER_WORKERS: '12',
				HISTORY_MAX_REQUESTS: '8',
				HISTORY_SCAN_PROCESSES: '24'
			},
			48
		);

		expect(plan).toEqual({
			perProcessHasherWorkers: 1,
			perProcessRequests: 1,
			processCount: 8,
			totalHasherWorkers: 12,
			totalRequests: 8
		});
	});

	it('partitions larger per-process budgets evenly', () => {
		const plan = createHistoryScanClusterPlan(
			{
				HISTORY_HASHER_WORKERS: '24',
				HISTORY_MAX_REQUESTS: '24',
				HISTORY_SCAN_PROCESSES: '6'
			},
			48
		);

		expect(plan).toEqual({
			perProcessHasherWorkers: 4,
			perProcessRequests: 4,
			processCount: 6,
			totalHasherWorkers: 24,
			totalRequests: 24
		});
	});

	it('rejects unbounded process counts', () => {
		expect(() =>
			createHistoryScanClusterPlan({ HISTORY_SCAN_PROCESSES: '25' }, 48)
		).toThrow('HISTORY_SCAN_PROCESSES must be between 1 and 24');
	});
});
