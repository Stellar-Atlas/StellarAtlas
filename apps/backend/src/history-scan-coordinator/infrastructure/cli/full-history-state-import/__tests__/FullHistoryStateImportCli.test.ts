import type { DataSource } from 'typeorm';
import { mock } from 'jest-mock-extended';
import {
	runFullHistoryStateImportCli,
	type FullHistoryStateImportCliDependencies
} from '../FullHistoryStateImportCli.js';

describe('runFullHistoryStateImportCli', () => {
	it('refuses to run unless explicitly enabled', async () => {
		const fixture = createFixture();

		await expect(
			runFullHistoryStateImportCli({}, fixture.dependencies)
		).resolves.toBe(64);
		expect(fixture.dependencies.createDataSource).not.toHaveBeenCalled();
	});

	it('fails closed when runtime or schema readiness is incomplete', async () => {
		const fixture = createFixture();
		fixture.dependencies.checkReadiness.mockResolvedValue({
			missingRuntimeObjects: ['executable:missing-or-inaccessible'],
			missingSchemaObjects: ['relation:full_history_lcm_state_import'],
			pendingMigrations: true,
			ready: false
		});

		await expect(
			runFullHistoryStateImportCli(enabled(), fixture.dependencies)
		).resolves.toBe(69);
		expect(fixture.dependencies.composeWorkers).not.toHaveBeenCalled();
		expect(fixture.dataSource.destroy).toHaveBeenCalledTimes(1);
	});

	it('starts the configured bounded workers and closes its database pool', async () => {
		const fixture = createFixture();

		await expect(
			runFullHistoryStateImportCli(enabled(), fixture.dependencies)
		).resolves.toBe(0);
		expect(fixture.dependencies.composeWorkers).toHaveBeenCalledTimes(1);
		expect(fixture.dependencies.runWorkerLoop).toHaveBeenCalledTimes(1);
		expect(fixture.dataSource.destroy).toHaveBeenCalledTimes(1);
		expect(fixture.dependencies.stdout.write).toHaveBeenCalledWith(
			expect.stringContaining('"status":"ready"')
		);
	});
});

function createFixture() {
	const dataSource = mock<DataSource>();
	Object.defineProperty(dataSource, 'isInitialized', {
		configurable: true,
		get: () => true
	});
	Object.defineProperty(dataSource, 'options', {
		configurable: true,
		value: {
			migrationsRun: false,
			poolSize: 3,
			synchronize: false,
			type: 'postgres'
		}
	});
	dataSource.initialize.mockResolvedValue(dataSource);
	dataSource.destroy.mockResolvedValue();
	const dependencies = {
		checkReadiness: jest.fn().mockResolvedValue({
			missingRuntimeObjects: [],
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		}),
		composeWorkers: jest.fn().mockReturnValue([
			{
				execute: jest.fn().mockResolvedValue(null),
				workerId: '00000000-0000-4000-8000-000000000001',
				workerIndex: 1
			}
		]),
		createDataSource: jest.fn(() => dataSource),
		now: () => 1_000,
		registerSignals: jest.fn(() => jest.fn()),
		runWorkerLoop: jest.fn().mockResolvedValue(undefined),
		stderr: { write: jest.fn() },
		stdout: { write: jest.fn() },
		wait: jest.fn().mockResolvedValue(undefined)
	};
	return {
		dataSource,
		dependencies: dependencies as typeof dependencies &
			FullHistoryStateImportCliDependencies
	};
}

function enabled(): NodeJS.ProcessEnv {
	return {
		FULL_HISTORY_STATE_IMPORT_ENABLED: 'true',
		FULL_HISTORY_STATE_IMPORT_WORKERS: '1'
	};
}
