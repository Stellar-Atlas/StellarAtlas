import 'reflect-metadata';
import { Container } from 'inversify';
import { getConfigFromEnv } from '../Config.js';
import { load } from '../../di/container.js';
import { TYPES } from '../../di/di-types.js';
import {
	createHistoryArchiveObjectClusterPlan,
	HistoryArchiveObjectClusterSupervisor
} from '../../cli/HistoryArchiveObjectClusterSupervisor.js';
import { VerifyArchiveObjects } from '../../../use-cases/verify-archive-objects/VerifyArchiveObjects.js';

describe('process-wide object hash budget', () => {
	const originalEnv = process.env;
	beforeEach(() => {
		process.env = {
			COORDINATOR_API_BASE_URL: 'http://localhost:9999',
			COORDINATOR_API_USERNAME: 'test',
			COORDINATOR_API_PASSWORD: 'test'
		};
	});
	afterEach(() => {
		process.env = originalEnv;
	});
	function config() {
		const result = getConfigFromEnv();
		if (result.isErr()) throw result.error;
		return result.value;
	}
	it('divides60hashers by12processes once, not again by10logical slots', () => {
		const env = {
			...process.env,
			HISTORY_OBJECT_WORKER_PROCESSES: '120',
			HISTORY_OBJECT_CLUSTER_PROCESSES: '12',
			HISTORY_HASHER_WORKERS: '60',
			HISTORY_OBJECT_DOWNLOAD_CONCURRENCY: '120'
		};
		const plan = createHistoryArchiveObjectClusterPlan(env, 64);
		const children: NodeJS.ProcessEnv[] = [];
		new HistoryArchiveObjectClusterSupervisor(plan, env, (child) => {
			children.push(child);
			return { id: children.length };
		}).start();
		const budgets = children.map((child) => {
			process.env = child;
			const value = config();
			expect(value.historyScanWorkers).toBe(10);
			expect(value.historyHasherWorkers).toBe(1); // Legacy per-scanner allocation remains unchanged.
			return value.historyObjectHasherWorkers;
		});
		expect(budgets).toEqual(Array(12).fill(5));
		expect(budgets.reduce((a, b) => a + b, 0)).toBe(60);
		expect(plan.maximumActiveDownloads).toBe(120);
	});
	it.each([
		['1', '60', 60],
		['10', '60', 6],
		['4', '7', 1]
	])(
		'preserves standalone per-scanner budgets for%s slots /%s hashers',
		(slots, hashers, legacy) => {
			process.env.HISTORY_SCAN_WORKERS = slots;
			process.env.HISTORY_HASHER_WORKERS = hashers;
			const value = config();
			expect(value.historyHasherWorkers).toBe(legacy);
			expect(value.historyObjectHasherWorkers).toBe(Number(hashers));
		}
	);
	it('routes only the object workflow to the process-wide shared pool count', () => {
		process.env.HISTORY_SCAN_WORKERS = '10';
		process.env.HISTORY_HASHER_WORKERS = '5';
		const container = new Container();
		load(container, config());
		expect(container.get<number>(TYPES.HasherWorkerCount)).toBe(1);
		expect(container.get<number>(TYPES.ObjectHasherWorkerCount)).toBe(5);
		const tagged = Reflect.getMetadata(
			'inversify:tagged',
			VerifyArchiveObjects
		) as Record<string, readonly { key: string; value: unknown }[]>;
		expect(tagged['9']).toContainEqual({
			key: 'inject',
			value: TYPES.ObjectHasherWorkerCount
		});
	});
	it('keeps defaults bounded and rejects invalid total hash budgets for both workflows', () => {
		const value = config();
		expect(value.historyObjectHasherWorkers).toBe(value.historyHasherWorkers);
		expect(value.historyObjectHasherWorkers).toBeGreaterThanOrEqual(1);
		expect(value.historyObjectHasherWorkers).toBeLessThanOrEqual(32767);
		process.env.HISTORY_HASHER_WORKERS = '0';
		expect(getConfigFromEnv().isErr()).toBe(true);
		process.env.HISTORY_HASHER_WORKERS = '32768';
		expect(getConfigFromEnv().isErr()).toBe(true);
	});
});
