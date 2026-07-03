import { NetworkSearchService } from '../NetworkSearchService.js';
import { createDummyNetworkV1 } from '@network-scan/services/__fixtures__/createDummyNetworkV1.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { createDummyOrganizationV1 } from '@network-scan/services/__fixtures__/createDummyOrganizationV1.js';

describe('NetworkSearchService', () => {
	it('searches latest network documents without requiring Meilisearch', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'sdf';
		organization.name = 'Stellar Development Foundation';
		organization.homeDomain = 'stellar.org';

		const node = createDummyNodeV1('GA_SEARCH_NODE');
		node.name = 'SDF Validator 1';
		node.homeDomain = 'stellar.org';
		node.organizationId = organization.id;
		organization.validators = [node.publicKey];

		const network = createDummyNetworkV1([node], [organization]);
		const service = new NetworkSearchService({
			indexName: 'test_network_entities'
		});

		const result = await service.search(network, {
			limit: 8,
			query: 'stellar'
		});

		expect(result.source).toBe('memory');
		expect(result.hits.map((hit) => hit.label)).toContain(
			'Stellar Development Foundation'
		);
		expect(result.hits.map((hit) => hit.label)).toContain('SDF Validator 1');
	});

	it('filters by entity type', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'lobstr';
		organization.name = 'LOBSTR';

		const node = createDummyNodeV1('GA_LOBSTR_NODE');
		node.name = 'lobstr5';
		node.organizationId = organization.id;

		const network = createDummyNetworkV1([node], [organization]);
		const service = new NetworkSearchService({
			indexName: 'test_network_entities'
		});

		const result = await service.search(network, {
			entityType: 'organization',
			limit: 8,
			query: 'lobstr'
		});

		expect(result.hits).toHaveLength(1);
		expect(result.hits[0]?.entityType).toBe('organization');
	});

	it('returns facet counts for filtered results', async () => {
		const organization = createDummyOrganizationV1();
		organization.id = 'sdf';
		organization.name = 'SDF';
		organization.homeDomain = 'stellar.org';

		const archiveErrorNode = createDummyNodeV1('GA_ARCHIVE_ERROR');
		archiveErrorNode.name = 'SDF validator';
		archiveErrorNode.homeDomain = 'stellar.org';
		archiveErrorNode.organizationId = organization.id;
		archiveErrorNode.historyArchiveHasError = true;

		const archiveOkNode = createDummyNodeV1('GA_ARCHIVE_OK');
		archiveOkNode.name = 'SDF observer';
		archiveOkNode.homeDomain = 'stellar.org';
		archiveOkNode.organizationId = organization.id;
		archiveOkNode.historyArchiveHasError = false;

		const network = createDummyNetworkV1(
			[archiveErrorNode, archiveOkNode],
			[organization]
		);
		const service = new NetworkSearchService({
			indexName: 'test_network_entities'
		});

		const result = await service.search(network, {
			archiveStatus: 'error',
			entityType: 'node',
			limit: 8,
			query: 'stellar'
		});

		expect(result.hits.map((hit) => hit.entityId)).toEqual([
			archiveErrorNode.publicKey
		]);
		expect(result.facets.archiveStatus).toEqual([{ count: 1, value: 'error' }]);
		expect(result.facets.entityType).toEqual([{ count: 1, value: 'node' }]);
		expect(result.facets.fullValidator).toEqual([{ count: 1, value: 'true' }]);
		expect(result.facets.validator).toEqual([{ count: 1, value: 'true' }]);
	});
});
