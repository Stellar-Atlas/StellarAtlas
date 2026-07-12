import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	runFullHistoryOperationBackfillCli,
	type FullHistoryOperationBackfillCliDependencies
} from '../FullHistoryOperationBackfillCli.js';

const confirmedEnvironment = {
	FULL_HISTORY_NETWORK_PASSPHRASE: 'CLI fixture network',
	FULL_HISTORY_OPERATION_BACKFILL_OPERATOR_CONFIRM:
		'run-one-bounded-operation-backfill'
};

describe('FullHistoryOperationBackfillCli', () => {
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
			batchLimit: 8,
			completedBatches: 1,
			operationFacts: 24,
			receipts: [
				{
					batchId: '00000000-0000-4000-8000-000000000001',
					operationCount: 24,
					replayed: false
				}
			],
			selectedBatches: 1,
			status: 'completed'
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
			networkPassphrase: 'CLI fixture network'
		});
		expect(dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('"operationFacts":24')
		);
		expect(dependencies.dataSource.destroy).toHaveBeenCalled();
	});

	it('rejects a batch limit that would exceed the bounded invocation', async () => {
		const dependencies = createDependencies();

		await expect(
			runFullHistoryOperationBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_OPERATION_BACKFILL_BATCHES: '9'
				},
				dependencies
			)
		).resolves.toBe(64);
		expect(dependencies.createDataSource).not.toHaveBeenCalled();
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
	const dependencies = {
		checkReadiness: jest.fn().mockResolvedValue({
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		}),
		createDataSource: jest.fn(() => dataSource),
		dataSource,
		execute: jest.fn(),
		stderr: { write: jest.fn() },
		stdout: { write: jest.fn() }
	};
	return dependencies as typeof dependencies &
		FullHistoryOperationBackfillCliDependencies;
}
