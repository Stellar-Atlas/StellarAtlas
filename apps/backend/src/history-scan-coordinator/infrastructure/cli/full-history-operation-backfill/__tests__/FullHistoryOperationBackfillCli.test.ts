import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	runFullHistoryOperationBackfillCli,
	type FullHistoryOperationBackfillCliDependencies
} from '../FullHistoryOperationBackfillCli.js';
import {
	createFullHistoryOperationBackfillDataSource,
	FULL_HISTORY_OPERATION_BACKFILL_POOL_SIZE,
	FullHistoryOperationBackfillExecutionError
} from '../FullHistoryOperationBackfillComposition.js';
import type { FullHistoryOperationWorkerMetrics } from '../WorkerThreadFullHistoryCheckpointDecoder.js';

const confirmedEnvironment = {
	FULL_HISTORY_NETWORK_PASSPHRASE: 'CLI fixture network',
	FULL_HISTORY_OPERATION_BACKFILL_OPERATOR_CONFIRM:
		'run-one-bounded-operation-backfill'
};

describe('FullHistoryOperationBackfillCli', () => {
	it('reserves database connections for leadership and every CPU worker', () => {
		const dataSource = createFullHistoryOperationBackfillDataSource();

		expect(FULL_HISTORY_OPERATION_BACKFILL_POOL_SIZE).toBe(14);
		expect(dataSource.options.poolSize).toBe(14);
		expect(dataSource.options.migrationsRun).toBe(false);
		expect(dataSource.options.synchronize).toBe(false);
	});

	it('refuses execution without explicit operator confirmation', async () => {
		const dependencies = createDependencies();

		await expect(
			runFullHistoryOperationBackfillCli({}, dependencies)
		).resolves.toBe(64);
		expect(dependencies.createDataSource).not.toHaveBeenCalled();
		expect(dependencies.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('refused')
		);
	});

	it('refuses an incomplete schema without executing work', async () => {
		const dependencies = createDependencies();
		dependencies.checkReadiness.mockResolvedValue({
			missingSchemaObjects: [
				'full_history_operation_batch_coverage.operation_decoder_version'
			],
			pendingMigrations: true,
			ready: false
		});

		await expect(
			runFullHistoryOperationBackfillCli(confirmedEnvironment, dependencies)
		).resolves.toBe(69);
		expect(dependencies.execute).not.toHaveBeenCalled();
		expect(dependencies.dataSource.destroy).toHaveBeenCalled();
	});

	it('runs one bounded invocation and emits its durable outcome', async () => {
		const dependencies = createDependencies();
		dependencies.execute.mockResolvedValue({
			accountReferenceFacts: 48,
			batchLimit: 8,
			completedBatches: 1,
			cpuWorkers: 2,
			operationFacts: 24,
			peakActiveBatches: 1,
			receipts: [
				{
					accountReferenceCount: 48,
					batchId: '00000000-0000-4000-8000-000000000001',
					operationCount: 24,
					replayed: false
				}
			],
			selectedBatches: 1,
			status: 'completed',
			workerMetrics: workerMetrics()
		});

		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '8'
				},
				dependencies
			)
		).resolves.toBe(0);
		expect(dependencies.execute).toHaveBeenCalledWith(dependencies.dataSource, {
			batchLimit: 8,
			cpuWorkerCount: 2,
			networkPassphrase: 'CLI fixture network'
		});
		expect(dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('"operationFacts":24')
		);
		expect(dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('"accountReferenceFacts":48')
		);
		expect(dependencies.dataSource.destroy).toHaveBeenCalled();
	});

	it('emits worker metrics and releases leadership after execution failure', async () => {
		const dependencies = createDependencies();
		dependencies.execute.mockRejectedValue(
			new FullHistoryOperationBackfillExecutionError(
				workerMetrics({ completedTasks: 0, failedTasks: 1 }),
				new Error('canceling statement due to statement timeout')
			)
		);

		await expect(
			runFullHistoryOperationBackfillCli(confirmedEnvironment, dependencies)
		).resolves.toBe(75);
		expect(dependencies.releaseLeadership).toHaveBeenCalledTimes(1);
		expect(dependencies.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('"failedTasks":1')
		);
		expect(dependencies.dataSource.destroy).toHaveBeenCalledTimes(1);
	});

	it('uses an explicit bounded CPU cap and refuses values above the hard maximum', async () => {
		const configured = createDependencies();
		configured.execute.mockResolvedValue({
			accountReferenceFacts: 0,
			batchLimit: 24,
			completedBatches: 0,
			cpuWorkers: 12,
			operationFacts: 0,
			peakActiveBatches: 0,
			receipts: [],
			selectedBatches: 0,
			status: 'idle',
			workerMetrics: workerMetrics({ workerCapacity: 12 })
		});

		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '24',
					FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS: '12'
				},
				configured
			)
		).resolves.toBe(0);
		expect(configured.execute).toHaveBeenCalledWith(configured.dataSource, {
			batchLimit: 24,
			cpuWorkerCount: 12,
			networkPassphrase: 'CLI fixture network'
		});

		const excessive = createDependencies();
		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS: '13'
				},
				excessive
			)
		).resolves.toBe(64);
		expect(excessive.createDataSource).not.toHaveBeenCalled();
	});

	it('skips without executing when another scheduler owns the advisory lock', async () => {
		const dependencies = createDependencies();
		dependencies.acquireLeadership.mockResolvedValue({
			acquired: false,
			release: dependencies.releaseLeadership
		});

		await expect(
			runFullHistoryOperationBackfillCli(confirmedEnvironment, dependencies)
		).resolves.toBe(0);
		expect(dependencies.execute).not.toHaveBeenCalled();
		expect(dependencies.releaseLeadership).toHaveBeenCalledTimes(1);
		expect(dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('skipped-locked')
		);
	});

	it('rejects a batch limit that would exceed the bounded invocation', async () => {
		const dependencies = createDependencies();

		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '25'
				},
				dependencies
			)
		).resolves.toBe(64);
		expect(dependencies.createDataSource).not.toHaveBeenCalled();
	});

	it('keeps multi-batch output bounded while retaining durable batch identities', async () => {
		const dependencies = createDependencies();
		const receipts = Array.from({ length: 24 }, (_, index) => ({
			accountReferenceCount: 2,
			batchId: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`,
			operationCount: 1,
			replayed: false
		}));
		dependencies.execute.mockResolvedValue({
			accountReferenceFacts: 48,
			batchLimit: 24,
			completedBatches: 24,
			cpuWorkers: 12,
			operationFacts: 24,
			peakActiveBatches: 12,
			receipts,
			selectedBatches: 24,
			status: 'completed',
			workerMetrics: workerMetrics({
				completedTasks: 24,
				peakActiveWorkers: 12,
				workerCapacity: 12
			})
		});

		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '24',
					FULL_HISTORY_OPERATION_BACKFILL_CPU_WORKERS: '12'
				},
				dependencies
			)
		).resolves.toBe(0);
		const output = String(
			dependencies.stdout.write.mock.calls.at(-1)?.[0] ?? ''
		);
		expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4_097);
		expect(output).toContain('"completedBatches":24');
		expect(output).toContain(receipts[23]!.batchId);
		expect(output).not.toContain('"receipts"');
		expect(output).not.toContain('output-bound-exceeded');
	});
});

function createDependencies() {
	const dataSource = mock<DataSource>();
	Object.defineProperty(dataSource, 'isInitialized', {
		configurable: true,
		get: () => true
	});
	Object.defineProperty(dataSource, 'options', {
		configurable: true,
		value: { migrationsRun: false, synchronize: false, type: 'postgres' }
	});
	dataSource.initialize.mockResolvedValue(dataSource);
	dataSource.destroy.mockResolvedValue();
	const releaseLeadership = jest.fn().mockResolvedValue(undefined);
	const dependencies = {
		acquireLeadership: jest.fn().mockResolvedValue({
			acquired: true,
			release: releaseLeadership
		}),
		checkReadiness: jest.fn().mockResolvedValue({
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		}),
		createDataSource: jest.fn(() => dataSource),
		dataSource,
		execute: jest.fn(),
		releaseLeadership,
		stderr: { write: jest.fn() },
		stdout: { write: jest.fn() }
	};
	return dependencies as typeof dependencies &
		FullHistoryOperationBackfillCliDependencies;
}

function workerMetrics(
	overrides: Partial<FullHistoryOperationWorkerMetrics> = {}
): FullHistoryOperationWorkerMetrics {
	return {
		activeWorkers: 0,
		completedTasks: 1,
		failedTasks: 0,
		peakActiveWorkers: 1,
		peakArrayBuffersBytes: 1,
		peakExternalBytes: 1,
		peakHeapUsedBytes: 1,
		queuedTasks: 0,
		resourceLimitMb: 2_048,
		retryCount: 0,
		workerCapacity: 2,
		...overrides
	};
}
