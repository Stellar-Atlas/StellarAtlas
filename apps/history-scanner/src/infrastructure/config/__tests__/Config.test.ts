import { jest } from '@jest/globals';
import {
	calculatePerScannerRequestConcurrency,
	calculatePerScannerWorkerConcurrency,
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

		test('should require internal coordinator credentials by default', () => {
			process.env.COORDINATOR_API_BASE_URL = 'http://api';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain('COORDINATOR_API_USERNAME');
			expect(result.error.message).toContain('COORDINATOR_API_PASSWORD');
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
				coordinatorAuth: {
					type: 'internal',
					username: 'user',
					password: 'pass'
				},
				logLevel: 'info',
				historyMaxFileMs: 60000,
				historySlowArchiveMaxLedgers: 1000,
				historyScanWorkers: 1,
				historyHasherWorkers: expect.any(Number),
				historyMaxRequests: 24,
				historyScanRangeSize: 250000,
				historyBucketCacheMaxBytes: 10 * 1024 * 1024 * 1024 * 1024
			});
			expect(result.value.historyHasherWorkers).toBeGreaterThanOrEqual(1);
			expect(result.value.historyHasherWorkers).toBeLessThanOrEqual(24);
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
			process.env.HISTORY_HASHER_WORKERS = '25';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_HASHER_WORKERS must be between 1 and 24'
			);
		});

		test('should validate HISTORY_SCAN_WORKERS maximum', () => {
			process.env.HISTORY_SCAN_WORKERS = '25';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_SCAN_WORKERS must be between 1 and 24'
			);
		});

		test('should validate HISTORY_MAX_REQUESTS maximum', () => {
			process.env.HISTORY_MAX_REQUESTS = '25';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_MAX_REQUESTS must be between 1 and 24'
			);
		});

		test('should validate HISTORY_SCAN_RANGE_SIZE is a positive integer', () => {
			process.env.HISTORY_SCAN_RANGE_SIZE = '0';

			const result = getConfigFromEnv();
			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'HISTORY_SCAN_RANGE_SIZE must be a positive integer'
			);
		});

		test('should accept valid numeric values', () => {
			process.env.HISTORY_MAX_FILE_MS = '120000';
			process.env.HISTORY_SLOW_ARCHIVE_MAX_LEDGERS = '2000';
			process.env.HISTORY_SCAN_WORKERS = '6';
			process.env.HISTORY_HASHER_WORKERS = '12';
			process.env.HISTORY_MAX_REQUESTS = '12';
			process.env.HISTORY_SCAN_RANGE_SIZE = '100000';
			process.env.HISTORY_BUCKET_CACHE_MAX_BYTES = String(
				2 * 1024 * 1024 * 1024
			);

			const result = getConfigFromEnv();
			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;

			expect(result.value.historyMaxFileMs).toBe(120000);
			expect(result.value.historySlowArchiveMaxLedgers).toBe(2000);
			expect(result.value.historyScanWorkers).toBe(6);
			expect(result.value.historyHasherWorkers).toBe(2);
			expect(result.value.historyMaxRequests).toBe(2);
			expect(result.value.historyScanRangeSize).toBe(100000);
			expect(result.value.historyBucketCacheMaxBytes).toBe(
				2 * 1024 * 1024 * 1024
			);
		});

		test('should derive default hasher workers from scanner workers and CPU count', () => {
			expect(calculateDefaultHistoryHasherWorkers(24, 64)).toBe(1);
			expect(calculateDefaultHistoryHasherWorkers(1, 64)).toBe(24);
			expect(calculateDefaultHistoryHasherWorkers(64, 64)).toBe(1);
		});

		test('should derive per-scanner worker concurrency from the total worker cap', () => {
			expect(calculatePerScannerWorkerConcurrency(24, 24)).toBe(1);
			expect(calculatePerScannerWorkerConcurrency(24, 6)).toBe(4);
			expect(calculatePerScannerWorkerConcurrency(12, 24)).toBe(1);
		});

		test('should derive per-scanner request concurrency from the total request cap', () => {
			expect(calculatePerScannerRequestConcurrency(24, 24)).toBe(1);
			expect(calculatePerScannerRequestConcurrency(24, 6)).toBe(4);
			expect(calculatePerScannerRequestConcurrency(12, 24)).toBe(1);
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

		test('should configure community scanner coordinator auth', () => {
			delete process.env.COORDINATOR_API_USERNAME;
			delete process.env.COORDINATOR_API_PASSWORD;
			process.env.COORDINATOR_AUTH_MODE = 'community';
			process.env.COMMUNITY_SCANNER_ID = '164f7788-9edb-4bb5-81c1-b928d85a21a5';
			process.env.COMMUNITY_SCANNER_API_KEY = 'satlas_scanner_secret';

			const result = getConfigFromEnv();

			expect(result.isOk()).toBe(true);
			if (!result.isOk()) throw result.error;
			expect(result.value.coordinatorAuth).toEqual({
				type: 'community',
				scannerId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
				apiKey: 'satlas_scanner_secret'
			});
		});

		test('should require community scanner credentials in community mode', () => {
			process.env.COORDINATOR_AUTH_MODE = 'community';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain('COMMUNITY_SCANNER_ID');
			expect(result.error.message).toContain('COMMUNITY_SCANNER_API_KEY');
		});

		test('should reject unknown coordinator auth modes', () => {
			process.env.COORDINATOR_AUTH_MODE = 'oauth';

			const result = getConfigFromEnv();

			expect(result.isErr()).toBe(true);
			if (!result.isErr()) throw new Error('Expected error');
			expect(result.error.message).toContain(
				'COORDINATOR_AUTH_MODE must be internal or community'
			);
		});
	});
});
