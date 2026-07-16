import { parseFullHistoryStateImportServiceConfig } from '../FullHistoryStateImportServiceConfig.js';

describe('parseFullHistoryStateImportServiceConfig', () => {
	it('uses bounded autonomous service defaults', () => {
		expect(parseFullHistoryStateImportServiceConfig(enabled())).toEqual({
			databasePoolSize: 6,
			errorBackoffMilliseconds: 30_000,
			executablePath:
				'/home/observe/stellarbeat-data/Observer/apps/full-history-etl/bin/stellaratlas-full-history-state-export',
			exportProcessCount: 3,
			exportTimeoutMilliseconds: 10_800_000,
			idlePollMilliseconds: 15_000,
			insertBatchSize: 250,
			leaseDurationMilliseconds: 600_000,
			storageRoot: '/home/observe/stellarbeat-data/full-history/typed',
			workerCount: 4
		});
	});

	it('raises the legacy 30-minute unit value to the operational minimum', () => {
		expect(
			parseFullHistoryStateImportServiceConfig({
				...enabled(),
				FULL_HISTORY_STATE_EXPORT_TIMEOUT_MS: '1800000'
			}).exportTimeoutMilliseconds
		).toBe(10_800_000);
	});

	it('requires explicit enablement', () => {
		expect(() => parseFullHistoryStateImportServiceConfig({})).toThrow(
			/FULL_HISTORY_STATE_IMPORT_ENABLED/
		);
	});

	it.each([
		{ FULL_HISTORY_STATE_IMPORT_WORKERS: '5' },
		{ FULL_HISTORY_STATE_EXPORT_PROCESSES: '4' },
		{ FULL_HISTORY_STATE_IMPORT_INSERT_ROWS: '501' },
		{ FULL_HISTORY_STATE_IMPORT_LEASE_MS: '9999' },
		{ FULL_HISTORY_STATE_EXPORT_TIMEOUT_MS: '999' },
		{ FULL_HISTORY_STATE_IMPORT_STORAGE_ROOT: 'relative/path' }
	])('rejects unsafe runtime bounds %#', (override) => {
		expect(() =>
			parseFullHistoryStateImportServiceConfig({ ...enabled(), ...override })
		).toThrow();
	});
});

function enabled(): NodeJS.ProcessEnv {
	return { FULL_HISTORY_STATE_IMPORT_ENABLED: 'true' };
}
