import { getConfigFromEnv, parseNetworkConfig } from '../Config.js';
import {
	defaultMeilisearchNetworkIndex,
	defaultMeilisearchScpStatementIndex
} from '../SearchConfigDefaults.js';

describe('Config', function () {
	describe('S3Region', function () {
		test('should set correct region', function () {
			process.env.ENABLE_S3_BACKUP = 'true';
			process.env.AWS_REGION = 'region';
			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;
			expect(config.value.s3Region).toEqual('region');
		});
	});

	describe('test networkScanLoopIntervalMs', function () {
		test('set correct value through number string', function () {
			process.env.NETWORK_SCAN_LOOP_INTERVAL_MS = '1000';
			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.networkScanLoopIntervalMs).toEqual(1000);
		});

		test('undefined if not set', function () {
			process.env.NETWORK_SCAN_LOOP_INTERVAL_MS = undefined;

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.networkScanLoopIntervalMs).toBeUndefined();
		});
	});

	describe('meilisearchNetworkIndex', function () {
		const originalIndex = process.env.MEILISEARCH_NETWORK_INDEX;

		afterEach(() => {
			if (originalIndex === undefined) {
				delete process.env.MEILISEARCH_NETWORK_INDEX;
			} else {
				process.env.MEILISEARCH_NETWORK_INDEX = originalIndex;
			}
		});

		test('defaults to the versioned network search index', function () {
			delete process.env.MEILISEARCH_NETWORK_INDEX;

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchNetwork.indexName).toBe(
				defaultMeilisearchNetworkIndex
			);
		});

		test('allows an explicit network search index override', function () {
			process.env.MEILISEARCH_NETWORK_INDEX = 'custom_network_index';

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchNetwork.indexName).toBe(
				'custom_network_index'
			);
		});
	});

	describe('meilisearchScpStatementIndex', function () {
		const originalIndex = process.env.MEILISEARCH_SCP_STATEMENT_INDEX;

		afterEach(() => {
			if (originalIndex === undefined) {
				delete process.env.MEILISEARCH_SCP_STATEMENT_INDEX;
			} else {
				process.env.MEILISEARCH_SCP_STATEMENT_INDEX = originalIndex;
			}
		});

		test('defaults to the versioned SCP statement search index', function () {
			delete process.env.MEILISEARCH_SCP_STATEMENT_INDEX;

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchScp.indexName).toBe(
				defaultMeilisearchScpStatementIndex
			);
		});

		test('allows an explicit SCP statement search index override', function () {
			process.env.MEILISEARCH_SCP_STATEMENT_INDEX = 'custom_scp_index';

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchScp.indexName).toBe('custom_scp_index');
		});
	});

	describe('meilisearch workload connections', function () {
		const variableNames = [
			'MEILISEARCH_API_KEY',
			'MEILISEARCH_HOST',
			'MEILISEARCH_NETWORK_API_KEY',
			'MEILISEARCH_NETWORK_HOST',
			'MEILISEARCH_SCP_API_KEY',
			'MEILISEARCH_SCP_HOST'
		] as const;
		const originals = new Map(
			variableNames.map((name) => [name, process.env[name]] as const)
		);

		afterEach(() => {
			for (const name of variableNames) {
				const value = originals.get(name);
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		});

		test('keeps network and SCP connection overrides independent', function () {
			process.env.MEILISEARCH_API_KEY = 'legacy-key';
			process.env.MEILISEARCH_HOST = 'http://127.0.0.1:7700';
			process.env.MEILISEARCH_NETWORK_API_KEY = 'network-key';
			process.env.MEILISEARCH_NETWORK_HOST = 'http://127.0.0.1:7701';
			process.env.MEILISEARCH_SCP_API_KEY = 'scp-key';
			process.env.MEILISEARCH_SCP_HOST = 'http://127.0.0.1:7702';

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchNetwork).toMatchObject({
				apiKey: 'network-key',
				host: 'http://127.0.0.1:7701'
			});
			expect(config.value.meilisearchScp).toMatchObject({
				apiKey: 'scp-key',
				host: 'http://127.0.0.1:7702'
			});
		});

		test('does not route the generic connection to network search', function () {
			process.env.MEILISEARCH_API_KEY = 'generic-key';
			process.env.MEILISEARCH_HOST = 'http://127.0.0.1:7700';
			delete process.env.MEILISEARCH_NETWORK_API_KEY;
			delete process.env.MEILISEARCH_NETWORK_HOST;

			const config = getConfigFromEnv();
			expect(config.isOk()).toBe(true);
			if (!config.isOk()) throw config.error;

			expect(config.value.meilisearchNetwork).toMatchObject({
				writable: false
			});
			expect(config.value.meilisearchNetwork.apiKey).toBeUndefined();
			expect(config.value.meilisearchNetwork.host).toBeUndefined();
			expect(config.value.meilisearchScp).toMatchObject({
				apiKey: 'generic-key',
				host: 'http://127.0.0.1:7700'
			});
		});
	});

	describe('parseNetworkConfig', function () {
		beforeEach(() => {
			jest.resetModules();
			process.env = {};
		});

		test('should return correct network config', function () {
			setupCorrectNetworkConfig();
			const result = parseNetworkConfig();
			if (!result.isOk()) throw result.error;
			expect(result.isOk()).toBe(true);
			const networkConfig = result.value;
			expect(networkConfig.knownPeers).toEqual(['B']);
			expect(networkConfig.ledgerVersion).toEqual(0);
			expect(networkConfig.stellarCoreVersion).toEqual('0.0.0');
			expect(networkConfig.networkPassphrase).toEqual('passphrase');
			expect(networkConfig.networkId).toEqual('id');
			expect(networkConfig.networkName).toEqual('name');
			expect(networkConfig.overlayMinVersion).toEqual(1);
			expect(networkConfig.overlayVersion).toEqual(2);
			expect(networkConfig.quorumSet).toEqual(['A']);
		});

		test('should return error if network config is not defined', function () {
			const result = parseNetworkConfig();
			expect(result.isErr()).toBe(true);
		});

		function setupCorrectNetworkConfig(): void {
			process.env.NETWORK_KNOWN_PEERS = '["B"]';
			process.env.NETWORK_LEDGER_VERSION = '0';
			process.env.NETWORK_STELLAR_CORE_VERSION = '0.0.0';
			process.env.NETWORK_PASSPHRASE = 'passphrase';
			process.env.NETWORK_ID = 'id';
			process.env.NETWORK_NAME = 'name';
			process.env.NETWORK_OVERLAY_MIN_VERSION = '1';
			process.env.NETWORK_OVERLAY_VERSION = '2';
			process.env.NETWORK_QUORUM_SET = '["A"]';
		}
	});
});
