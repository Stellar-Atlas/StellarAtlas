import { resolveScpStatementObservationRuntimePolicy } from '../ScpStatementObservationPolicy.js';

describe('ScpStatementObservationPolicy', () => {
	it('uses bounded persistence defaults', () => {
		expect(resolveScpStatementObservationRuntimePolicy({})).toEqual({
			databaseLockTimeoutMs: 2_000,
			databaseStatementTimeoutMs: 10_000,
			persistenceRetryInitialDelayMs: 250,
			persistenceRetryMaxDelayMs: 30_000
		});
	});

	it('accepts explicit bounded timeout and retry settings', () => {
		expect(
			resolveScpStatementObservationRuntimePolicy({
				SCP_LIVE_DATABASE_LOCK_TIMEOUT_MS: '3000',
				SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS: '45000',
				SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS: '500',
				SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS: '60000'
			})
		).toEqual({
			databaseLockTimeoutMs: 3_000,
			databaseStatementTimeoutMs: 45_000,
			persistenceRetryInitialDelayMs: 500,
			persistenceRetryMaxDelayMs: 60_000
		});
	});

	it.each([
		['SCP_LIVE_DATABASE_LOCK_TIMEOUT_MS', '99'],
		['SCP_LIVE_DATABASE_LOCK_TIMEOUT_MS', '10001'],
		['SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS', '4999'],
		['SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS', '120001'],
		['SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS', '49'],
		['SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS', '60001'],
		['SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS', '249'],
		['SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS', '300001'],
		['SCP_LIVE_DATABASE_STATEMENT_TIMEOUT_MS', '1e4'],
		['SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS', '1.5']
	])('rejects invalid %s value %s', (name, value) => {
		expect(() =>
			resolveScpStatementObservationRuntimePolicy({ [name]: value })
		).toThrow(name);
	});

	it('rejects a retry cap below the initial delay', () => {
		expect(() =>
			resolveScpStatementObservationRuntimePolicy({
				SCP_LIVE_PERSISTENCE_RETRY_INITIAL_DELAY_MS: '1000',
				SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS: '500'
			})
		).toThrow(/SCP_LIVE_PERSISTENCE_RETRY_MAX_DELAY_MS/);
	});
});
