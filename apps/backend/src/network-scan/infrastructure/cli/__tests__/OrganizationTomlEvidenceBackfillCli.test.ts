import { DataSource } from 'typeorm';
import { AppDataSource } from '@core/infrastructure/database/AppDataSource.js';
import {
	createOrganizationTomlBackfillDataSource,
	ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE,
	runOrganizationTomlBackfillCli,
	type OrganizationTomlBackfillCliDependencies
} from '../OrganizationTomlEvidenceBackfillCli.js';

describe('organization TOML evidence backfill CLI', () => {
	it('creates an isolated data source that cannot run pending migrations', () => {
		const dataSource = createOrganizationTomlBackfillDataSource();

		expect(dataSource.options.migrationsRun).toBe(false);
		expect(dataSource).not.toBe(AppDataSource);
	});

	it('returns exit 75 for a disk-capacity pause and destroys the connection', async () => {
		const fixture = createDependencies();
		fixture.runBatch.mockResolvedValue({
			completed: false,
			insertedAttempts: 0,
			pauseReason: 'insufficient_disk',
			peakEstimateBytes: '1',
			processedOrganizations: 0,
			quarantinedRows: 0
		});

		await expect(
			runOrganizationTomlBackfillCli(
				['node', 'backfill', '10'],
				{},
				fixture.dependencies
			)
		).resolves.toBe(ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE);
		expect(fixture.initialize).toHaveBeenCalledTimes(1);
		expect(fixture.destroy).toHaveBeenCalledTimes(1);
		expect(fixture.runMigrations).not.toHaveBeenCalled();
	});

	it('returns exit 75 without running a batch when PostgreSQL is down', async () => {
		const fixture = createDependencies();
		const downDataSource = new DataSource({
			connectTimeoutMS: 250,
			migrationsRun: false,
			type: 'postgres',
			url: 'postgresql://postgres@127.0.0.1:1/postgres'
		});
		const dependencies: OrganizationTomlBackfillCliDependencies = {
			...fixture.dependencies,
			createDataSource: () => downDataSource
		};

		await expect(
			runOrganizationTomlBackfillCli(['node', 'backfill'], {}, dependencies)
		).resolves.toBe(ORGANIZATION_TOML_BACKFILL_TEMPORARY_FAILURE_EXIT_CODE);
		expect(dependencies.runBatch).not.toHaveBeenCalled();
		expect(downDataSource.isInitialized).toBe(false);
		expect(fixture.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('ECONNREFUSED')
		);
	});
});

function createDependencies() {
	let initialized = false;
	const initialize = jest.fn(async () => {
		initialized = true;
		return dataSource;
	});
	const destroy = jest.fn(async () => {
		initialized = false;
	});
	const runMigrations = jest.fn();
	const dataSource = {
		destroy,
		initialize,
		get isInitialized() {
			return initialized;
		},
		runMigrations
	} as unknown as DataSource;
	const stderr = { write: jest.fn() };
	const stdout = { write: jest.fn() };
	const runBatch = jest.fn().mockResolvedValue({
		completed: true,
		insertedAttempts: 0,
		pauseReason: null,
		peakEstimateBytes: '1',
		processedOrganizations: 0,
		quarantinedRows: 0
	});
	const dependencies: OrganizationTomlBackfillCliDependencies = {
		createDataSource: () => dataSource,
		readAvailableBytes: jest.fn().mockResolvedValue(20n * 1_024n ** 3n),
		runBatch,
		stderr,
		stdout
	};
	return {
		dependencies,
		destroy,
		initialize,
		runMigrations,
		runBatch,
		stderr
	};
}
