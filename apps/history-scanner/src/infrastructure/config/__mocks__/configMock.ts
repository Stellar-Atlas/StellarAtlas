import { Config } from '../Config.js';
import type { CoordinatorAuthConfig } from '../CoordinatorAuthConfig.js';

export class ConfigMock implements Config {
	nodeEnv = 'test';
	enableSentry = false;
	sentryDSN = 'test-dsn';
	environment = 'test';
	userAgent = 'stellaratlas-history-scanner-test';
	logLevel = 'debug';
	historyMaxFileMs = 60000;
	historySlowArchiveMaxLedgers = 1000;
	historyScanWorkers = 1;
	historyHasherWorkers = 1;
	historyMaxRequests = 1;
	historyScanRangeSize = 100000;
	historyBucketCacheDir = '/tmp/stellaratlas-history-scanner-test-cache';
	historyBucketCacheMaxBytes = 1024 * 1024 * 1024;
	coordinatorAPIBaseUrl = 'http://127.0.0.1:3000';
	coordinatorAuth: CoordinatorAuthConfig = {
		type: 'internal',
		username: 'test-user',
		password: 'test-password'
	};
}
