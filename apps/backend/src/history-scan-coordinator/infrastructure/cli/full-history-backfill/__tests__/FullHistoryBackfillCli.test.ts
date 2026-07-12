import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	runFullHistoryBackfillCli,
	type FullHistoryBackfillCliDependencies
} from '../FullHistoryBackfillCli.js';

const confirmedEnvironment = {
	FULL_HISTORY_BACKFILL_OPERATOR_CONFIRM: 'run-one-bounded-backfill-invocation',
	FULL_HISTORY_NETWORK_PASSPHRASE: 'CLI fixture network'
};

describe('FullHistoryBackfillCli', () => {
	it('refuses execution without explicit operator confirmation', async () => {
		const dependencies = createDependencies();
		await expect(runFullHistoryBackfillCli({}, dependencies)).resolves.toBe(64);
		expect(dependencies.createDataSource).not.toHaveBeenCalled();
		expect(dependencies.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('refused')
		);
	});

	it('refuses an incomplete schema without executing work', async () => {
		const dependencies = createDependencies();
		dependencies.checkReadiness.mockResolvedValue({
			missingSchemaObjects: ['full_history_historical_backfill_job'],
			pendingMigrations: false,
			ready: false
		});
		await expect(
			runFullHistoryBackfillCli(confirmedEnvironment, dependencies)
		).resolves.toBe(69);
		expect(dependencies.execute).not.toHaveBeenCalled();
		expect(dependencies.dataSource.destroy).toHaveBeenCalled();
	});

	it('runs one bounded invocation and emits its durable outcome', async () => {
		const dependencies = createDependencies();
		dependencies.execute.mockResolvedValue({
			run: {
				jobId: '00000000-0000-4000-8000-000000000001',
				processedCheckpoints: 2,
				status: 'completed'
			},
			schedule: {
				job: mock(),
				status: 'scheduled'
			}
		});
		await expect(
			runFullHistoryBackfillCli(
				{
					...confirmedEnvironment,
					FULL_HISTORY_BACKFILL_CHECKPOINTS: '2'
				},
				dependencies
			)
		).resolves.toBe(0);
		expect(dependencies.execute).toHaveBeenCalledWith(
			dependencies.dataSource,
			expect.objectContaining({ checkpointCount: 2 }),
			'00000000-0000-4000-8000-000000000099'
		);
		expect(dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('completed')
		);
	});

	it('returns a temporary exit for proof-pending without claiming success', async () => {
		const dependencies = createDependencies();
		dependencies.execute.mockResolvedValue({
			run: {
				checkpointLedger: 127,
				jobId: '00000000-0000-4000-8000-000000000001',
				jobState: 'pending',
				processedCheckpoints: 0,
				status: 'proof-pending'
			},
			schedule: { job: mock(), status: 'existing' }
		});
		await expect(
			runFullHistoryBackfillCli(confirmedEnvironment, dependencies)
		).resolves.toBe(75);
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
		createWorkerId: jest.fn(() => '00000000-0000-4000-8000-000000000099'),
		dataSource,
		execute: jest.fn(),
		stderr: { write: jest.fn() },
		stdout: { write: jest.fn() }
	};
	return dependencies as typeof dependencies &
		FullHistoryBackfillCliDependencies;
}
