import { CompareRadarApiDocsOperations } from '../CompareRadarApiDocsOperations.js';
import type {
	CrossCheckApiDocsOperationDTO,
	StellarAtlasApiDocsOperationSnapshotDTO
} from '../../../domain/CrossCheckApiDocsComparison.js';
import type {
	RadarApiDocsSnapshotDTO,
	RadarApiOperationMethod
} from '../../../domain/RadarApiDocs.js';

describe('CompareRadarApiDocsOperations', () => {
	it('should compare operation presence by method and path', () => {
		const useCase = new CompareRadarApiDocsOperations(
			() => new Date('2026-07-03T12:30:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot([
				createOperation({
					operationId: 'getNetwork',
					path: '/v1',
					summary: 'Network',
					tags: ['Network']
				}),
				createOperation({
					operationId: 'getNodes',
					path: '/v1/node',
					tags: ['Node']
				})
			]),
			stellarAtlas: createStellarAtlasSnapshot([
				createOperation({
					operationId: 'getNetwork',
					path: '/v1',
					summary: 'Network',
					tags: ['Network']
				}),
				createOperation({
					operationId: 'getOrganizations',
					path: '/v1/organization',
					tags: ['Organization']
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.summary).toEqual({
			fieldMismatchCount: 0,
			matchedCount: 1,
			sourceMissingCount: 1,
			stellarAtlasMissingCount: 1,
			totalCount: 3
		});
		expect(
			result.value.operations.map((operation) => ({
				key: operation.key,
				status: operation.comparisonStatus
			}))
		).toEqual([
			{ key: { method: 'get', path: '/v1' }, status: 'matched' },
			{
				key: { method: 'get', path: '/v1/node' },
				status: 'stellaratlas_missing'
			},
			{
				key: { method: 'get', path: '/v1/organization' },
				status: 'source_missing'
			}
		]);
		expect(result.value.generatedAt).toBe('2026-07-03T12:30:00.000Z');
		expect(result.value.source).toMatchObject({
			observedAt: '2026-07-03T12:00:00.000Z',
			operationCount: 2,
			sourceId: 'withobsrvr-radar'
		});
		expect(result.value.stellarAtlas).toMatchObject({
			observedAt: '2026-07-03T12:05:00.000Z',
			operationCount: 2,
			sourceId: 'stellaratlas-api'
		});
	});

	it('should report metadata field mismatches for matching operations', () => {
		const useCase = new CompareRadarApiDocsOperations(
			() => new Date('2026-07-03T12:30:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot([
				createOperation({
					operationId: 'getNode',
					path: '/v1/node/{publicKey}',
					schemaRefs: ['#/components/schemas/RadarNode'],
					summary: 'RADAR node',
					tags: ['Node']
				})
			]),
			stellarAtlas: createStellarAtlasSnapshot([
				createOperation({
					operationId: 'getNodeByPublicKey',
					path: '/v1/node/{publicKey}',
					schemaRefs: ['#/components/schemas/StellarAtlasNode'],
					summary: 'Node',
					tags: ['HistoryScan', 'Node']
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;

		expect(result.value.summary).toEqual({
			fieldMismatchCount: 1,
			matchedCount: 0,
			sourceMissingCount: 0,
			stellarAtlasMissingCount: 0,
			totalCount: 1
		});
		expect(result.value.operations[0]).toMatchObject({
			comparisonStatus: 'field_mismatch',
			key: { method: 'get', path: '/v1/node/{publicKey}' },
			fieldMismatches: [
				{
					field: 'operationId',
					sourceValue: 'getNode',
					stellarAtlasValue: 'getNodeByPublicKey'
				},
				{
					field: 'schemaRefs',
					sourceValue: ['#/components/schemas/RadarNode'],
					stellarAtlasValue: ['#/components/schemas/StellarAtlasNode']
				},
				{
					field: 'summary',
					sourceValue: 'RADAR node',
					stellarAtlasValue: 'Node'
				},
				{
					field: 'tags',
					sourceValue: ['Node'],
					stellarAtlasValue: ['HistoryScan', 'Node']
				}
			]
		});
	});

	it('should ignore schema ref and tag ordering when classifying matches', () => {
		const useCase = new CompareRadarApiDocsOperations(
			() => new Date('2026-07-03T12:30:00.000Z')
		);

		const result = useCase.execute({
			radar: createRadarSnapshot([
				createOperation({
					path: '/v1/organization',
					schemaRefs: ['#/B', '#/A'],
					tags: ['Organization', 'Network']
				})
			]),
			stellarAtlas: createStellarAtlasSnapshot([
				createOperation({
					path: '/v1/organization',
					schemaRefs: ['#/A', '#/B'],
					tags: ['Network', 'Organization']
				})
			])
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) throw result.error;
		expect(result.value.operations[0].comparisonStatus).toBe('matched');
		expect(result.value.operations[0].fieldMismatches).toEqual([]);
	});
});

function createRadarSnapshot(
	operations: readonly CrossCheckApiDocsOperationDTO[]
): RadarApiDocsSnapshotDTO {
	return {
		assetUrl: 'https://radar.withobsrvr.com/api/docs/swagger-ui-init.js',
		contentHashSha256: 'fixture-hash',
		documentationUrl: 'https://radar.withobsrvr.com/api/docs/',
		fetchedAt: '2026-07-03T12:00:00.000Z',
		openapiVersion: '3.0.3',
		operations,
		servers: [{ description: null, url: 'https://radar.withobsrvr.com/api' }],
		sourceId: 'withobsrvr-radar',
		title: 'RADAR API',
		version: '1.0.0',
		warnings: []
	};
}

function createStellarAtlasSnapshot(
	operations: readonly CrossCheckApiDocsOperationDTO[]
): StellarAtlasApiDocsOperationSnapshotDTO {
	return {
		documentationUrl: '/docs',
		loadedAt: '2026-07-03T12:05:00.000Z',
		operations,
		sourceId: 'stellaratlas-api',
		title: 'StellarAtlas.io API',
		version: 'v1'
	};
}

function createOperation(
	overrides: Partial<CrossCheckApiDocsOperationDTO> = {}
): CrossCheckApiDocsOperationDTO {
	return {
		method: overrides.method ?? ('get' satisfies RadarApiOperationMethod),
		operationId: overrides.operationId ?? null,
		path: overrides.path ?? '/v1',
		schemaRefs: overrides.schemaRefs ?? [],
		summary: overrides.summary ?? null,
		tags: overrides.tags ?? []
	};
}
