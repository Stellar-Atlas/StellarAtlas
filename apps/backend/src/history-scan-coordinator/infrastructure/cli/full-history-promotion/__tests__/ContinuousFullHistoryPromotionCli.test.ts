import {
	parseLoopConfig,
	waitForFullHistoryPromotionSchemaReadiness
} from '../ContinuousFullHistoryPromotionCli.js';
import { selectFullHistoryPromotionMigrations } from '../FullHistoryPromotionSchemaReadiness.js';

const enabledEnvironment = {
	FULL_HISTORY_CONTINUOUS_PROMOTION_ENABLED: 'true',
	FULL_HISTORY_NETWORK_PASSPHRASE: 'Continuous promotion fixture network'
};

describe('continuous full-history promotion CLI', () => {
	it('uses a bounded error backoff by default', () => {
		expect(parseLoopConfig(enabledEnvironment)).toMatchObject({
			errorBackoffMs: 30_000,
			maximumCheckpointsPerCycle: 4,
			pollIntervalMs: 15_000
		});
	});

	it('accepts an explicit error backoff within the service bounds', () => {
		expect(
			parseLoopConfig({
				...enabledEnvironment,
				FULL_HISTORY_PROMOTION_ERROR_BACKOFF_MS: '45000'
			})
		).toMatchObject({ errorBackoffMs: 45_000 });
	});

	it('rejects an error backoff that could busy-loop', () => {
		expect(() =>
			parseLoopConfig({
				...enabledEnvironment,
				FULL_HISTORY_PROMOTION_ERROR_BACKOFF_MS: '999'
			})
		).toThrow('between 1000 and 86400000');
	});

	it('filters only exact unrelated names without mutating input or cloning entries', () => {
		const migrations = [
			{ name: 'HistoryArchiveHeaderProofRepairQueueKindMigration1793384400000' },
			{ name: 'FullHistoryCanonicalSchemaMigration1784860000000' },
			{ name: 'AtlasAccountVerification1794091000000' },
			{ name: 'FutureUnreviewedMigration1999999999999' },
			{ name: 'AtlasVerificationAuthentication1794092000000' },
			{ name: 'AtlasDeveloperAuthentication1794232800000' },
			{ name: 'AtlasDeveloperSubmissions1794744000000' }
		];
		const originalOrder = [...migrations];
		const selected = selectFullHistoryPromotionMigrations(migrations);

		expect(selected.map(({ name }) => name)).toEqual([
			'FullHistoryCanonicalSchemaMigration1784860000000',
			'FutureUnreviewedMigration1999999999999'
		]);
		expect(selected[0]).toBe(migrations[1]);
		expect(selected[1]).toBe(migrations[3]);
		expect(migrations).toEqual(originalOrder);
		for (const index of migrations.keys())
			expect(migrations[index]).toBe(originalOrder[index]);
	});

	it('does not filter a similarly named migration with a different timestamp', () => {
		const nearby = { name: 'AtlasDeveloperSubmissions1794744000001' };
		const selected = selectFullHistoryPromotionMigrations([nearby]);
		expect(selected).toEqual([nearby]);
		expect(selected[0]).toBe(nearby);
	});

	it('waits in process for pending migrations and then becomes ready', async () => {
		const pending = {
			missingSchemaObjects: ['relation:full_history_ledger'],
			pendingMigrations: true,
			ready: false
		} as const;
		const ready = {
			missingSchemaObjects: [],
			pendingMigrations: false,
			ready: true
		} as const;
		const checkReadiness = jest
			.fn()
			.mockResolvedValueOnce(pending)
			.mockResolvedValueOnce(ready);
		const emit = jest.fn();
		const wait = jest.fn(async () => undefined);

		await expect(
			waitForFullHistoryPromotionSchemaReadiness(30_000, {
				checkReadiness,
				emit,
				shouldStop: () => false,
				wait
			})
		).resolves.toEqual(ready);
		expect(wait).toHaveBeenCalledTimes(1);
		expect(wait).toHaveBeenCalledWith(30_000);
		expect(emit).toHaveBeenCalledWith({
			errorCode: 'schema-migrations-pending',
			missingSchemaObjects: ['relation:full_history_ledger'],
			pendingMigrations: true,
			retryInMs: 30_000,
			status: 'schema-not-ready'
		});
	});

	it('returns permanent missing schema state without retrying', async () => {
		const missing = {
			missingSchemaObjects: ['relation:full_history_ledger'],
			pendingMigrations: false,
			ready: false
		} as const;
		const emit = jest.fn();
		const wait = jest.fn(async () => undefined);

		await expect(
			waitForFullHistoryPromotionSchemaReadiness(30_000, {
				checkReadiness: async () => missing,
				emit,
				shouldStop: () => false,
				wait
			})
		).resolves.toEqual(missing);
		expect(emit).not.toHaveBeenCalled();
		expect(wait).not.toHaveBeenCalled();
	});

	it('stops promptly while waiting for schema readiness', async () => {
		let stopped = false;
		const emit = jest.fn();
		const wait = jest.fn(async () => {
			stopped = true;
		});

		await expect(
			waitForFullHistoryPromotionSchemaReadiness(30_000, {
				checkReadiness: async () => ({
					missingSchemaObjects: [],
					pendingMigrations: true,
					ready: false
				}),
				emit,
				shouldStop: () => stopped,
				wait
			})
		).resolves.toBeNull();
		expect(wait).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledTimes(1);
	});
});
