import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import NodeMeasurement from '@network-scan/domain/node/NodeMeasurement.js';
import { createDummyNode } from '@network-scan/domain/node/__fixtures__/createDummyNode.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import type { OrganizationRepository } from '@network-scan/domain/organization/OrganizationRepository.js';
import { NodeDTOService } from '@network-scan/services/NodeDTOService.js';
import { createDummyNodeV1 } from '@network-scan/services/__fixtures__/createDummyNodeV1.js';
import { GetKnownNodes } from '../GetKnownNodes.js';

describe('GetKnownNodes', () => {
	it('returns current and archived nodes with snapshot and measurement evidence', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const archivedAt = new Date('2020-02-01T00:00:00.000Z');
		const activeNode = createDummyNode('127.0.0.1', 11625, start);
		activeNode.addMeasurement(new NodeMeasurement(start, activeNode));
		const archivedNode = createDummyNode('127.0.0.2', 11625, start);
		archivedNode.archive(archivedAt);

		const activeDto = createDummyNodeV1(activeNode.publicKey.value);
		const archivedDto = createDummyNodeV1(archivedNode.publicKey.value);
		activeDto.isValidator = true;
		archivedDto.isValidator = true;
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findAllKnown.mockResolvedValue([activeNode, archivedNode]);
		nodeRepository.findAllKnownIdentities.mockResolvedValue([
			{
				publicKey: activeNode.publicKey.value,
				dateDiscovered: start,
				lastMeasurementAt: start
			},
			{
				publicKey: archivedNode.publicKey.value,
				dateDiscovered: start,
				lastMeasurementAt: null
			}
		]);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(ok([activeDto, archivedDto]));

		const result = await new GetKnownNodes(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value.count).toBe(2);
		expect(result.value.scope).toBe('all-known');
		expect(result.value.scopeTotals).toEqual({
			'all-known': 2,
			archived: 1,
			'current-validator': 1,
			listener: 0,
			'public-key-only': 0
		});
		const activeResult = result.value.nodes.find(
			(node) => node.publicKey === activeNode.publicKey.value
		);
		const archivedResult = result.value.nodes.find(
			(node) => node.publicKey === archivedNode.publicKey.value
		);
		expect(activeResult).toMatchObject({
			publicKey: activeNode.publicKey.value,
			dateDiscovered: start.toISOString(),
			node: activeDto,
			metadataState: 'snapshot',
			current: true,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: null,
			lastSeen: start.toISOString(),
			lastMeasurementAt: start.toISOString()
		});
		expect(archivedResult).toMatchObject({
			publicKey: archivedNode.publicKey.value,
			dateDiscovered: start.toISOString(),
			node: archivedDto,
			metadataState: 'snapshot',
			current: false,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: archivedAt.toISOString(),
			lastSeen: archivedAt.toISOString(),
			lastMeasurementAt: null
		});
		expect(nodeDTOService.getNodeDTOs).toHaveBeenCalledWith(
			expect.any(Date),
			[activeNode, archivedNode],
			[]
		);
	});

	it('filters and paginates explicit node scopes with exact totals', async () => {
		const start = new Date('2020-01-01T00:00:00.000Z');
		const validator = createDummyNode('127.0.0.1', 11625, start);
		const listener = createDummyNode('127.0.0.2', 11625, start);
		const validatorDto = createDummyNodeV1(validator.publicKey.value);
		const listenerDto = createDummyNodeV1(listener.publicKey.value);
		validatorDto.isValidator = true;
		listenerDto.isValidator = false;
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findAllKnown.mockResolvedValue([validator, listener]);
		nodeRepository.findAllKnownIdentities.mockResolvedValue([]);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(
			ok([validatorDto, listenerDto])
		);

		const result = await new GetKnownNodes(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute({
			limit: 1,
			offset: 0,
			query: listener.publicKey.value,
			scope: 'listener'
		});

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			count: 1,
			page: { hasMore: false, limit: 1, offset: 0, total: 1 },
			scope: 'listener'
		});
		expect(result.value.nodes).toEqual([
			expect.objectContaining({
				publicKey: listener.publicKey.value,
				scope: 'listener'
			})
		]);
	});

	it('returns public-key-only records for known nodes without snapshots', async () => {
		const discoveredAt = new Date('2020-03-01T00:00:00.000Z');
		const measuredAt = new Date('2020-03-02T00:00:00.000Z');
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findAllKnown.mockResolvedValue([]);
		nodeRepository.findAllKnownIdentities.mockResolvedValue([
			{
				publicKey: 'GA_SHELL_NODE',
				dateDiscovered: discoveredAt,
				lastMeasurementAt: measuredAt
			}
		]);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(ok([]));

		const result = await new GetKnownNodes(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute();

		expect(result.isOk()).toBe(true);
		if (result.isErr()) return;
		expect(result.value).toMatchObject({
			count: 1,
			nodes: [
				{
					publicKey: 'GA_SHELL_NODE',
					dateDiscovered: discoveredAt.toISOString(),
					node: null,
					metadataState: 'public_key_only',
					current: false,
					snapshotStartDate: null,
					snapshotEndDate: null,
					lastSeen: measuredAt.toISOString(),
					lastMeasurementAt: measuredAt.toISOString(),
					scope: 'public-key-only'
				}
			]
		});
	});

	it('returns errors from the DTO service', async () => {
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const error = new Error('mapping failed');
		nodeRepository.findAllKnown.mockResolvedValue([]);
		nodeRepository.findAllKnownIdentities.mockResolvedValue([]);
		organizationRepository.findAllKnown.mockResolvedValue([]);
		nodeDTOService.getNodeDTOs.mockResolvedValue(err(error));

		const result = await new GetKnownNodes(
			nodeRepository,
			organizationRepository,
			nodeDTOService,
			exceptionLogger
		).execute();

		expect(result.isErr()).toBe(true);
		expect(exceptionLogger.captureException).toHaveBeenCalledWith(error);
	});
});
