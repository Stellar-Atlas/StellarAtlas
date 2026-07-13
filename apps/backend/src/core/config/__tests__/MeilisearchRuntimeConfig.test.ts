import { parseMeilisearchRuntimeConfig } from '../MeilisearchRuntimeConfig.js';
import {
	defaultMeilisearchNetworkIndex,
	defaultMeilisearchScpStatementIndex
} from '../SearchConfigDefaults.js';

describe('parseMeilisearchRuntimeConfig', () => {
	it('keeps the generic connection for SCP and disables network search', () => {
		const config = parseMeilisearchRuntimeConfig({
			MEILISEARCH_API_KEY: 'legacy-key',
			MEILISEARCH_HOST: 'http://127.0.0.1:7700'
		});

		expect(config.network).toEqual({
			apiKey: undefined,
			host: undefined,
			indexName: defaultMeilisearchNetworkIndex,
			writable: false
		});
		expect(config.scp).toEqual({
			apiKey: 'legacy-key',
			host: 'http://127.0.0.1:7700',
			indexName: defaultMeilisearchScpStatementIndex
		});
	});

	it('selects independent network and SCP connections', () => {
		const config = parseMeilisearchRuntimeConfig({
			MEILISEARCH_API_KEY: 'legacy-key',
			MEILISEARCH_HOST: 'http://127.0.0.1:7700',
			MEILISEARCH_NETWORK_API_KEY: 'network-key',
			MEILISEARCH_NETWORK_HOST: 'http://127.0.0.1:7701',
			MEILISEARCH_SCP_API_KEY: 'scp-key',
			MEILISEARCH_SCP_HOST: 'http://127.0.0.1:7702'
		});

		expect(config.network).toMatchObject({
			apiKey: 'network-key',
			host: 'http://127.0.0.1:7701'
		});
		expect(config.scp).toMatchObject({
			apiKey: 'scp-key',
			host: 'http://127.0.0.1:7702'
		});
	});

	it('never borrows a generic key for the dedicated network host', () => {
		const config = parseMeilisearchRuntimeConfig({
			MEILISEARCH_API_KEY: ' legacy-key ',
			MEILISEARCH_HOST: ' http://127.0.0.1:7700 ',
			MEILISEARCH_NETWORK_API_KEY: ' ',
			MEILISEARCH_NETWORK_HOST: 'http://127.0.0.1:7701',
			MEILISEARCH_SCP_API_KEY: 'scp-key',
			MEILISEARCH_SCP_HOST: ''
		});

		expect(config.network).toMatchObject({
			host: 'http://127.0.0.1:7701',
			writable: true
		});
		expect(config.network.apiKey).toBeUndefined();
		expect(config.scp).toMatchObject({
			apiKey: 'scp-key',
			host: 'http://127.0.0.1:7700'
		});
	});

	it('does not enable network search from a key or index alone', () => {
		const config = parseMeilisearchRuntimeConfig({
			MEILISEARCH_HOST: 'http://127.0.0.1:7700',
			MEILISEARCH_NETWORK_API_KEY: 'network-key',
			MEILISEARCH_NETWORK_INDEX: 'network_v4'
		});

		expect(config.network).toEqual({
			apiKey: undefined,
			host: undefined,
			indexName: 'network_v4',
			writable: false
		});
	});

	it('can disable only the network projection writer', () => {
		const config = parseMeilisearchRuntimeConfig({
			API_SEARCH_PROJECTION_WRITER: 'false',
			MEILISEARCH_NETWORK_HOST: 'http://127.0.0.1:7701'
		});

		expect(config.network.writable).toBe(false);
		expect(config.scp).not.toHaveProperty('writable');
	});
});
