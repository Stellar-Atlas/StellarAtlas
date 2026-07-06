import { createHistoryArchiveObjectClusterPlan } from '../verify-archive-objects-cluster.js';

describe('verify-archive-objects-cluster', () => {
	it('defaults to 24 object worker processes on the production CPU class', () => {
		const plan = createHistoryArchiveObjectClusterPlan({}, 48);

		expect(plan).toEqual({
			perProcessHasherWorkers: 1,
			processCount: 24,
			totalHasherWorkers: 24
		});
	});

	it('divides total hasher workers across bounded lower object worker process counts', () => {
		const plan = createHistoryArchiveObjectClusterPlan(
			{
				HISTORY_HASHER_WORKERS: '24',
				HISTORY_OBJECT_WORKER_PROCESSES: '12'
			},
			48
		);

		expect(plan).toEqual({
			perProcessHasherWorkers: 2,
			processCount: 12,
			totalHasherWorkers: 24
		});
	});

	it('rejects unbounded object worker process counts', () => {
		expect(() =>
			createHistoryArchiveObjectClusterPlan(
				{ HISTORY_OBJECT_WORKER_PROCESSES: '25' },
				48
			)
		).toThrow('HISTORY_OBJECT_WORKER_PROCESSES must be between 1 and 24');
	});

	it('rejects unbounded object hasher worker counts', () => {
		expect(() =>
			createHistoryArchiveObjectClusterPlan(
				{ HISTORY_HASHER_WORKERS: '25' },
				48
			)
		).toThrow('HISTORY_HASHER_WORKERS must be between 1 and 24');
	});
});
