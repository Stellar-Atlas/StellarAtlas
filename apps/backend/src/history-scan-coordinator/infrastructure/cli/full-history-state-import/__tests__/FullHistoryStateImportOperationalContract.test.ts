import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
	runFullHistoryStateImportCli,
	type FullHistoryStateImportCliDependencies
} from '../FullHistoryStateImportCli.js';
import {
	runFullHistoryStateImportWorkerLoop,
	waitForFullHistoryStateImport,
	type FullHistoryStateImportWorkerEvent
} from '../FullHistoryStateImportWorkerLoop.js';

describe('full-history state-import operational contract', () => {
	it('starts four loops and emits exact JSON lifecycle events by default', async () => {
		const stdout: string[] = [];
		const stderr: string[] = [];
		const workerIndexes: number[] = [];
		const poolSizes: number[] = [];
		const mutable = {
			destroy: async (): Promise<void> => {
				mutable.isInitialized = false;
			},
			initialize: async (): Promise<DataSource> => {
				mutable.isInitialized = true;
				return mutable as unknown as DataSource;
			},
			isInitialized: false,
			options: {
				migrationsRun: false,
				poolSize: 6,
				synchronize: false,
				type: 'postgres'
			}
		};
		const workers = Array.from({ length: 4 }, (_, index) => ({
			execute: async () => null,
			workerId: randomUUID(),
			workerIndex: index + 1
		}));
		const dependencies: FullHistoryStateImportCliDependencies = {
			checkReadiness: async () => ({
				missingRuntimeObjects: [],
				missingSchemaObjects: [],
				pendingMigrations: false,
				ready: true
			}),
			composeWorkers: () => workers,
			createDataSource: (poolSize) => {
				poolSizes.push(poolSize);
				return mutable as unknown as DataSource;
			},
			now: () => 0,
			registerSignals: () => () => undefined,
			runWorkerLoop: async (_config, worker) => {
				workerIndexes.push(worker.workerIndex);
			},
			stderr: { write: (value) => stderr.push(value) },
			stdout: { write: (value) => stdout.push(value) },
			wait: async () => undefined
		};

		await expect(
			runFullHistoryStateImportCli(
				{ FULL_HISTORY_STATE_IMPORT_ENABLED: 'true' },
				dependencies
			)
		).resolves.toBe(0);
		expect(poolSizes).toEqual([6]);
		expect(workerIndexes).toEqual([1, 2, 3, 4]);
		expect(stderr).toEqual([]);
		expect(stdout).toEqual([
			'{"databasePoolSize":6,"event":"runtime","exportTimeoutMs":10800000,"insertRows":250,"leaseMs":600000,"status":"ready","storageRoot":"/home/observe/stellarbeat-data/full-history/typed","workers":4}\n',
			'{"event":"runtime","status":"stopped"}\n'
		]);
	});

	it('emits exact durable-completion and idle events', async () => {
		const abortController = new AbortController();
		const batchId = randomUUID();
		const events: FullHistoryStateImportWorkerEvent[] = [];
		let cycle = 0;
		await runFullHistoryStateImportWorkerLoop(
			{ errorBackoffMilliseconds: 30_000, idlePollMilliseconds: 15_000 },
			{
				emit: (event) => events.push(event),
				execute: async () => {
					cycle += 1;
					if (cycle === 1) {
						return {
							kind: 'state-import' as const,
							receipt: {
								batchId,
								dataset: 'trustline-state-changes',
								recordCount: 9n,
								rowSetSha256: 'a'.repeat(64)
							}
						};
					}
					if (cycle === 2) {
						return {
							kind: 'canonical-coverage' as const,
							receipt: {
								batchId,
								canonicalBatchCount: 2,
								ledgerCount: 64,
								minimumProofVersion: 6,
								status: 'complete' as const
							}
						};
					}
					return null;
				},
				formatError: String,
				now: () => 1_000,
				signal: abortController.signal,
				wait: async () => abortController.abort(),
				workerIndex: 3
			}
		);
		expect(events).toEqual([
			{
				at: '1970-01-01T00:00:01.000Z',
				batchId,
				dataset: 'trustline-state-changes',
				durationMs: 0,
				event: 'state-import',
				recordCount: '9',
				status: 'complete',
				worker: 3
			},
			{
				at: '1970-01-01T00:00:01.000Z',
				batchId,
				canonicalBatchCount: 2,
				durationMs: 0,
				event: 'canonical-coverage',
				ledgerCount: 64,
				minimumProofVersion: 6,
				status: 'complete',
				worker: 3
			},
			{
				at: '1970-01-01T00:00:01.000Z',
				event: 'worker-cycle',
				retryInMs: 15_000,
				status: 'idle',
				worker: 3
			}
		]);
	});

	it('interrupts a long wait as soon as the service signal aborts', async () => {
		const abortController = new AbortController();
		const waiting = waitForFullHistoryStateImport(
			60_000,
			abortController.signal
		);
		abortController.abort();
		await expect(waiting).resolves.toBeUndefined();
	});
});
