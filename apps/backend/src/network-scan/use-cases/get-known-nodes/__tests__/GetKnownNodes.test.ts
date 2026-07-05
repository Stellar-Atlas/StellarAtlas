import { err, ok } from 'neverthrow';
import { mock } from 'jest-mock-extended';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { Snapshot } from '@core/domain/Snapshot.js';
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
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		nodeRepository.findAllKnown.mockResolvedValue([activeNode, archivedNode]);
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
		expect(result.value.nodes[0]).toMatchObject({
			node: activeDto,
			current: true,
			snapshotStartDate: start.toISOString(),
			snapshotEndDate: Snapshot.MAX_DATE.toISOString(),
			lastSeen: start.toISOString(),
			lastMeasurementAt: start.toISOString()
		});
		expect(result.value.nodes[1]).toMatchObject({
			node: archivedDto,
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

	it('returns errors from the DTO service', async () => {
		const nodeRepository = mock<NodeRepository>();
		const organizationRepository = mock<OrganizationRepository>();
		const nodeDTOService = mock<NodeDTOService>();
		const exceptionLogger = mock<ExceptionLogger>();
		const error = new Error('mapping failed');
		nodeRepository.findAllKnown.mockResolvedValue([]);
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
