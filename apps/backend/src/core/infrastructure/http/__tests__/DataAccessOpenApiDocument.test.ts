import {
	DATA_ACCESS_HISTORY_DATASETS,
	withDataAccessOpenApiPaths
} from '../DataAccessOpenApiDocument.js';

describe('data-access OpenAPI paths', () => {
	const document = withDataAccessOpenApiPaths({
		info: { title: 'test', version: '1' },
		openapi: '3.0.3',
		paths: {}
	});
	const paths = document.paths as Record<
		string,
		Record<string, Record<string, unknown>>
	>;

	it('documents every mounted public data-access route', () => {
		expect(paths['/horizon/']?.get?.operationId).toBe('getHorizonRoot');
		expect(paths['/rpc']?.post?.operationId).toBe('callStellarRpc');
		expect(paths['/galexie/.config.json']?.get?.operationId).toBe(
			'getGalexieConfiguration'
		);
		expect(paths['/v1/history-data/catalog']?.get?.operationId).toBe(
			'getHistoryDataCatalog'
		);
		expect(paths['/v1/analytics/assets/holders']?.get?.operationId).toBe(
			'listCurrentAssetHolders'
		);
		expect(paths['/v1/history-data/batches']?.get?.operationId).toBe(
			'listHistoryDataBatches'
		);
		expect(
			paths['/v1/history-data/batches/{batchId}/{dataset}']?.get?.operationId
		).toBe('downloadHistoryDataBatchArtifact');
		expect(
			paths['/v1/history-data/batches/{batchId}/{dataset}']?.head?.operationId
		).toBe('headHistoryDataBatchArtifact');
	});

	it('marks every operation public and preserves exact query bounds', () => {
		for (const path of Object.values(paths)) {
			for (const operation of Object.values(path)) {
				expect(operation.security).toEqual([]);
			}
		}
		const parameters = paths['/v1/history-data/batches']?.get
			?.parameters as Array<{
			readonly name: string;
			readonly schema: {
				readonly default?: number;
				readonly enum?: readonly string[];
				readonly maximum?: number;
			};
		}>;
		expect(
			parameters.find(({ name }) => name === 'dataset')?.schema.enum
		).toEqual(DATA_ACCESS_HISTORY_DATASETS);
		expect(
			parameters.find(({ name }) => name === 'limit')?.schema
		).toMatchObject({
			default: 25,
			maximum: 100
		});
		expect(
			parameters.find(({ name }) => name === 'beforeLedger')?.schema.maximum
		).toBe(4_294_967_295);
	});
	it('documents the exact Galexie config and pubnet history origin fields', () => {
		const galexieContract = JSON.stringify(
			paths['/galexie/.config.json']?.get?.responses
		);
		expect(galexieContract).toContain('networkPassphrase');
		expect(galexieContract).toContain('version');
		expect(galexieContract).not.toContain('schemaVersion');
		const catalogContract = JSON.stringify(
			paths['/v1/history-data/catalog']?.get?.responses
		);
		expect(catalogContract).toContain('historyOrigin');
		expect(catalogContract).toContain('firstLedgerCloseMeta');
	});

	it('refuses to silently replace an existing path contract', () => {
		expect(() =>
			withDataAccessOpenApiPaths({
				paths: { '/horizon/': { get: {} } }
			})
		).toThrow('OpenAPI data-access path already exists: /horizon/');
	});
});
