import {
	createHistoryArchiveObjectClusterPlan,
	HistoryArchiveObjectClusterSupervisor
} from '../HistoryArchiveObjectClusterSupervisor.js';

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

	it('replaces an exited nonzero worker with the same stable index', () => {
		let nextWorkerId = 100;
		const forks: NodeJS.ProcessEnv[] = [];
		const supervisor = new HistoryArchiveObjectClusterSupervisor(
			createHistoryArchiveObjectClusterPlan({}, 48),
			{},
			(env) => {
				forks.push(env);
				return { id: nextWorkerId++ };
			}
		);

		supervisor.start();
		expect(forks).toHaveLength(24);
		expect(forks[17]).toMatchObject({
			HISTORY_OBJECT_WORKER_GENERATION: '0',
			HISTORY_OBJECT_WORKER_INDEX: '17'
		});

		expect(supervisor.replace(117)).toBe(true);
		expect(forks).toHaveLength(25);
		expect(forks[24]).toMatchObject({
			HISTORY_OBJECT_WORKER_GENERATION: '1',
			HISTORY_OBJECT_WORKER_INDEX: '17'
		});
		expect(forks[24]?.HISTORY_OBJECT_WORKER_INDEX).not.toBe('0');
	});
});
