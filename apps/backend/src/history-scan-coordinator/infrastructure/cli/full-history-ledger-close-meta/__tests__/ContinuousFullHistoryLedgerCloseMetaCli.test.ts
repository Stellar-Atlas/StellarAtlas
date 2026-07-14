import type { DataSource } from 'typeorm';
import type { FullHistoryLedgerCloseMetaComposition } from '../FullHistoryLedgerCloseMetaComposition.js';
import { parseFullHistoryLedgerCloseMetaServiceConfig } from '../FullHistoryLedgerCloseMetaServiceConfig.js';
import {
	monitorFullHistoryLedgerCloseMetaRuntimeCleanup,
	runContinuousFullHistoryLedgerCloseMetaCli
} from '../ContinuousFullHistoryLedgerCloseMetaCli.js';

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
