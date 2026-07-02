import { jest } from '@jest/globals';
import {
	calculateDefaultHistoryHasherWorkers,
	getConfigFromEnv
} from '../Config.js';

describe('Config', () => {
	beforeEach(() => {
		jest.resetModules();
		process.env = {};
	});

	describe('Required Variables', () => {
		test('should return error if required vars missing', () => {
			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain('Missing required env vars');
		});

		test('should validate coordinator settings', () => {
			process.env.COORDINATOR_API_USERNAME = 'user';
			process.env.COORDINATOR_API_PASSWORD = 'pass';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain('COORDINATOR_API_BASE_URL');
		});
	});

	describe('Optional Variables', () => {
		beforeEach(() => {
			// Set required vars for all optional var tests
			process.env.COORDINATOR_API_BASE_URL = 'http://api';
			process.env.COORDINATOR_API_USERNAME = 'user';
			process.env.COORDINATOR_API_PASSWORD = 'pass';
		});

		test('should use defaults for optional vars', () => {
			const result = getConfigFromEnv();
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			expect(result.value).toMatchObject({
				nodeEnv: 'development',
				enableSentry: false,
				userAgent: 'stellaratlas-history-scanner',
				logLevel: 'info',
				historyMaxFileMs: 60000,
				historySlowArchiveMaxLedgers: 1000,
				historyHasherWorkers: expect.any(Number)
			});
			expect(result.value.historyHasherWorkers).toBeGreaterThanOrEqual(1);
			expect(result.value.historyHasherWorkers).toBeLessThanOrEqual(8);
		});

		test('should require SENTRY_DSN when ENABLE_SENTRY is true', () => {
			process.env.ENABLE_SENTRY = 'true';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain('SENTRY_DSN required');
		});

		test('should validate HISTORY_MAX_FILE_MS is numeric', () => {
			process.env.HISTORY_MAX_FILE_MS = 'not-a-number';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_MAX_FILE_MS must be a number'
			);
		});

		test('should validate HISTORY_SLOW_ARCHIVE_MAX_LEDGERS is numeric', () => {
			process.env.HISTORY_SLOW_ARCHIVE_MAX_LEDGERS = 'invalid';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_SLOW_ARCHIVE_MAX_LEDGERS must be a number'
			);
		});

		test('should validate HISTORY_HASHER_WORKERS is a positive integer', () => {
			process.env.HISTORY_HASHER_WORKERS = '0';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_HASHER_WORKERS must be a positive integer'
			);
		});

		test('should validate HISTORY_HASHER_WORKERS maximum', () => {
			process.env.HISTORY_HASHER_WORKERS = '9';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_HASHER_WORKERS must be between 1 and 8'
			);
		});

		test('should accept valid numeric values', () => {
			process.env.HISTORY_MAX_FILE_MS = '120000';
			process.env.HISTORY_SLOW_ARCHIVE_MAX_LEDGERS = '2000';
			process.env.HISTORY_HASHER_WORKERS = '3';

			const result = getConfigFromEnv();
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			expect(result.value.historyMaxFileMs).toBe(120000);
			expect(result.value.historySlowArchiveMaxLedgers).toBe(2000);
			expect(result.value.historyHasherWorkers).toBe(3);
		});

		test('should derive default hasher workers from scanner workers and CPU count', () => {
			expect(calculateDefaultHistoryHasherWorkers(24, 64)).toBe(2);
			expect(calculateDefaultHistoryHasherWorkers(1, 64)).toBe(8);
			expect(calculateDefaultHistoryHasherWorkers(64, 64)).toBe(1);
		});

		test('should properly configure Sentry when enabled', () => {
			process.env.ENABLE_SENTRY = 'true';
			process.env.SENTRY_DSN = 'https://sentry.example.com';

			const result = getConfigFromEnv();
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			expect(result.value.enableSentry).toBe(true);
			expect(result.value.sentryDSN).toBe('https://sentry.example.com');
		});
	});
});
