import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NodeMeasurement from '@network-scan/domain/node/NodeMeasurement.js';
import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { GetKnownNode } from '../GetKnownNode.js';

describe('GetKnownNode', () => {
	it('returns a known snapshot node by public key', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const node = createDummyNode('127.0.0.1', 11625, start);
		node.addMeasurement(new NodeMeasurement(start, node));
		const nodeDto = createDummyNodeV1(node.publicKey.value);
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findOneByPublicKey.mockResolvedValue(node);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(ok([nodeDto]));

		const result = await new GetKnownNode(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute(node.publicKey.value);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			publicKey: node.publicKey.value,
			node: nodeDto,
			metadataState: 'snapshot',
			current: true,
			scope: 'current-validator',
			lastSeen: start.toISOString()
		});
		expect(nodeDTOService.getNodeDTOs).toHaveBeenCalledWith(
			expect.any(Date),
			[node],
			[]
		);
	});

	it('returns a public-key-only known identity when no snapshot exists', async () => {
		const discoveredAt = new Date('2020-03-01T00:00:00.000Z');
		const measuredAt = new Date('2020-03-02T00:00:00.000Z');
		const shellNode = createDummyNode('127.0.0.2', 11625, discoveredAt);
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findOneByPublicKey.mockResolvedValue(null);
		nodeRepository.findKnownIdentityByPublicKey.mockResolvedValue({
			publicKey: shellNode.publicKey.value,
			dateDiscovered: discoveredAt,
			lastMeasurementAt: measuredAt
		});

		const result = await new GetKnownNode(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute(shellNode.publicKey.value);

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			publicKey: shellNode.publicKey.value,
			node: null,
			metadataState: 'public_key_only',
			current: false,
			scope: 'public-key-only',
			lastSeen: measuredAt.toISOString()
		});
		expect(nodeDTOService.getNodeDTOs).not.toHaveBeenCalled();
		expect(nodeRepository.findKnownIdentityByPublicKey).toHaveBeenCalledWith(
			shellNode.publicKey.value
		);
		expect(nodeRepository.findAllKnownIdentities).not.toHaveBeenCalled();
	});

	it('returns null for malformed or unknown public keys', async () => {
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();

		const result = await new GetKnownNode(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute('not-a-public-key');

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toBeNull();
		expect(nodeRepository.findOneByPublicKey).not.toHaveBeenCalled();
	});

	it('returns errors from the DTO service', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const node = createDummyNode('127.0.0.1', 11625, start);
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const error = new Error('mapping failed');
		nodeRepository.findOneByPublicKey.mockResolvedValue(node);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(err(error));

		const result = await new GetKnownNode(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute(node.publicKey.value);

		expect(result.isErr()).toBe(true);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});
