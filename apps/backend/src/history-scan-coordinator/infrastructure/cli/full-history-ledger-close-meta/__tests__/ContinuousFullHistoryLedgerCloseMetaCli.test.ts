import type { DataSource } from 'typeorm';
import type { FullHistoryLedgerCloseMetaComposition } from '../FullHistoryLedgerCloseMetaComposition.js';
import { parseFullHistoryLedgerCloseMetaServiceConfig } from '../FullHistoryLedgerCloseMetaServiceConfig.js';
import {
	monitorFullHistoryLedgerCloseMetaRuntimeCleanup,
	runContinuousFullHistoryLedgerCloseMetaCli,
	type ContinuousFullHistoryLedgerCloseMetaCliDependencies
} from '../ContinuousFullHistoryLedgerCloseMetaCli.js';

describe('continuous source paired boot binding', () => {
	it.each(['stale', 'unreadable'])('refuses a %s paired boot before runtime initialization', async (fault) => {
		const f = bootFixture(false);
		if (fault === 'unreadable') f.isPairedCurrentBoot.mockRejectedValueOnce(new Error('boot ID unavailable'));
		const env = pairedEnvironment();
		const original = { ...env };

		await expect(runContinuousFullHistoryLedgerCloseMetaCli(env, f.dependencies)).resolves.toBe(64);

		expect(f.isPairedCurrentBoot).toHaveBeenCalledTimes(1);
		expect(f.registerSignals).not.toHaveBeenCalled();
		expect(f.ensureRuntime).not.toHaveBeenCalled();
		expect(f.compose).not.toHaveBeenCalled();
		expect(f.initialize).not.toHaveBeenCalled();
		expect(f.acquireLeadership).not.toHaveBeenCalled();
		expect(f.resetOwnedRuntime).not.toHaveBeenCalled();
		expect(f.runLoop).not.toHaveBeenCalled();
		expect(env).toEqual(original);
		expect(f.stderr.write).toHaveBeenCalledWith(expect.stringContaining('"status":"refused"'));
		if (fault === 'stale') expect(f.stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('Paired current admission belongs to another boot; preserve any pending plan')
		);
	});

	it('starts a matching paired boot with the original current-only geometry', async () => {
		const f = bootFixture(true);
		const env = pairedEnvironment();

		await expect(runContinuousFullHistoryLedgerCloseMetaCli(env, f.dependencies)).resolves.toBe(0);

		expect(f.isPairedCurrentBoot).toHaveBeenCalledWith(expect.objectContaining({ bootId: pairedBootId }));
		expect(f.initialize).toHaveBeenCalledTimes(1);
		expect(f.runLoop).toHaveBeenCalledWith(expect.objectContaining({
			cycleLedgerCount: 128, typedShardLedgerCount: 128,
			currentOnlyCapacity: { minimumLedger: 1000, minimumFreeBytes: 4000n }
		}), expect.objectContaining({ pairedCurrentAdmission: expect.anything() }));
	});

	it('starts ordinary mode without consulting the paired boot binding', async () => {
		const f = bootFixture(false);

		await expect(runContinuousFullHistoryLedgerCloseMetaCli(environment(), f.dependencies)).resolves.toBe(0);

		expect(f.isPairedCurrentBoot).not.toHaveBeenCalled();
		expect(f.initialize).toHaveBeenCalledTimes(1);
		expect(f.runLoop).toHaveBeenCalledWith(expect.objectContaining({
			cycleLedgerCount: 1024, typedShardLedgerCount: 1024
		}), expect.not.objectContaining({ pairedCurrentAdmission: expect.anything() }));
	});
});

describe('monitorFullHistoryLedgerCloseMetaRuntimeCleanup', () => {
	it('does not reset owned runtime paths without exclusive leadership', async () => {
		const resetOwnedRuntime = jest.fn(async () => undefined);
		const release = jest.fn(async () => undefined);
		const dataSource = {
			initialize: jest.fn(async () => undefined),
			isInitialized: false,
			query: jest.fn(async () => [
				{
					batch: 'full_history_ledger_close_meta_batch',
					dataset: 'full_history_ledger_close_meta_dataset',
					source: 'full_history_ledger_close_meta_source',
					sourceObject: 'full_history_ledger_close_meta_source_object',
					watermark: 'full_history_ledger_close_meta_watermark'
				}
			])
		} as unknown as DataSource;
		const exitCode = await runContinuousFullHistoryLedgerCloseMetaCli(
			environment(),
			{
				acquireLeadership: async () => ({
					acquired: false,
					assertHeld: async () => undefined,
					release
				}),
				checkReadiness: async () => ({
					missingSchemaObjects: [],
					pendingMigrations: false,
					ready: true
				}),
				compose: () =>
					({
						dataSource,
						frontier: { destroy: jest.fn() }
					}) as unknown as FullHistoryLedgerCloseMetaComposition,
				ensureRuntime: async () => undefined,
				now: () => 123_456,
				reconcileRuntime: async () => undefined,
				registerSignals: () => () => undefined,
				resetOwnedRuntime,
				runLoop: async () => undefined,
				stderr: { write: jest.fn() },
				stdout: { write: jest.fn() },
				wait: async () => undefined
			}
		);

		expect(exitCode).toBe(75);
		expect(resetOwnedRuntime).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledTimes(1);
	});

	it('fails closed before leadership when the schema contract is incomplete', async () => {
		const acquireLeadership = jest.fn();
		const runLoop = jest.fn(async () => undefined);
		const stderr = { write: jest.fn() };
		const dataSource = {
			initialize: jest.fn(async () => undefined),
			isInitialized: false
		} as unknown as DataSource;
		const exitCode = await runContinuousFullHistoryLedgerCloseMetaCli(
			environment(),
			{
				acquireLeadership,
				checkReadiness: async () => ({
					missingSchemaObjects: [
						'trigger:full_history_ledger_close_meta_batch.trg_validate_full_history_lcm_batch_datasets'
					],
					pendingMigrations: true,
					ready: false
				}),
				compose: () =>
					({
						dataSource,
						frontier: { destroy: jest.fn() }
					}) as unknown as FullHistoryLedgerCloseMetaComposition,
				ensureRuntime: async () => undefined,
				now: () => 123_456,
				reconcileRuntime: async () => undefined,
				registerSignals: () => () => undefined,
				resetOwnedRuntime: async () => undefined,
				runLoop,
				stderr,
				stdout: { write: jest.fn() },
				wait: async () => undefined
			}
		);

		expect(exitCode).toBe(69);
		expect(acquireLeadership).not.toHaveBeenCalled();
		expect(runLoop).not.toHaveBeenCalled();
		expect(stderr.write).toHaveBeenCalledWith(
			expect.stringContaining('"status":"schema-not-ready"')
		);
	});

	it('runs periodic cleanup and stops when the service shuts down', async () => {
		const abortController = new AbortController();
		const reconcileRuntime = jest.fn(async () => abortController.abort());
		const onFailure = jest.fn();

		await monitorFullHistoryLedgerCloseMetaRuntimeCleanup(
			config(),
			abortController,
			{
				now: () => 123_456,
				reconcileRuntime,
				wait: jest.fn(async () => undefined)
			},
			onFailure
		);

		expect(reconcileRuntime).toHaveBeenCalledWith(config(), 123_456);
		expect(onFailure).not.toHaveBeenCalled();
	});

	it('aborts the service and reports a cleanup failure', async () => {
		const abortController = new AbortController();
		const cleanupError = new Error('tmpfs cleanup refused');
		const onFailure = jest.fn();

		await monitorFullHistoryLedgerCloseMetaRuntimeCleanup(
			config(),
			abortController,
			{
				now: () => 123_456,
				reconcileRuntime: jest.fn(async () => Promise.reject(cleanupError)),
				wait: jest.fn(async () => undefined)
			},
			onFailure
		);

		expect(abortController.signal.aborted).toBe(true);
		expect(onFailure).toHaveBeenCalledWith(
			expect.objectContaining({
				cause: cleanupError,
				message: expect.stringMatching(/cleanup failed/i)
			})
		);
	});
});

const pairedBootId = 'abcdabcd-abcd-abcd-abcd-abcdabcdabcd';

function pairedEnvironment(): NodeJS.ProcessEnv {
	return {
		...environment(),
		FULL_HISTORY_LEDGER_CLOSE_META_PRIORITIZE_CURRENT: 'true',
		FULL_HISTORY_LEDGER_CLOSE_META_CYCLE_LEDGERS: '128',
		FULL_HISTORY_LEDGER_CLOSE_META_SHARD_LEDGERS: '128',
		FULL_HISTORY_LEDGER_CLOSE_META_MINIMUM_FREE_BYTES: '5000',
		FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MIN_LEDGER: '1000',
		FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_MINIMUM_FREE_BYTES: '4000',
		FULL_HISTORY_LEDGER_CLOSE_META_CURRENT_ONLY_PAIRED_ADMISSION: JSON.stringify({
			bootId: pairedBootId, warehouseReportedPath: '/bulk/warehouse',
			warehouseMetadataPath: '/run/warehouse-metadata', warehouseMetadataInode: '1',
			minimumUnreservedBytes: '10000000000'
		}),
		HUBBLE_CLICKHOUSE_URL: 'http://127.0.0.1:8123/',
		HUBBLE_CLICKHOUSE_DATABASE: 'hubble'
	};
}

function bootFixture(matches: boolean) {
	const initialize = jest.fn(async () => undefined);
	const dataSource = { initialize, isInitialized: false } as unknown as DataSource;
	const dependencies = {
		acquireLeadership: jest.fn(async () => ({
			acquired: true, assertHeld: async () => undefined, release: async () => undefined
		})),
		checkReadiness: async () => ({ missingSchemaObjects: [], pendingMigrations: false, ready: true }),
		compose: jest.fn(() => ({
			dataSource, frontier: { destroy: jest.fn() }
		}) as unknown as FullHistoryLedgerCloseMetaComposition),
		ensureRuntime: jest.fn(async () => undefined),
		isPairedCurrentBoot: jest.fn(async () => matches),
		now: () => 123_456,
		reconcileRuntime: async () => undefined,
		registerSignals: jest.fn(() => () => undefined),
		resetOwnedRuntime: jest.fn(async () => undefined),
		runLoop: jest.fn(async () => undefined),
		stderr: { write: jest.fn() },
		stdout: { write: jest.fn() },
		wait: async () => { throw new Error('fixture has no periodic waits'); }
	} satisfies ContinuousFullHistoryLedgerCloseMetaCliDependencies;
	return { ...dependencies, initialize, dependencies };
}

function config() {
	return parseFullHistoryLedgerCloseMetaServiceConfig(environment());
}

function environment(): NodeJS.ProcessEnv {
	return {
		FULL_HISTORY_LEDGER_CLOSE_META_ENABLED: 'true',
		FULL_HISTORY_NETWORK_PASSPHRASE:
			'Public Global Stellar Network ; September 2015'
	};
}
