import { NodeDTOService } from '../NodeDTOService.js';
import { mock } from 'jest-mock-extended';
import type { NodeMeasurementRepository } from '../../domain/node/NodeMeasurementRepository.js';
import type { NodeMeasurementDayRepository } from '../../domain/node/NodeMeasurementDayRepository.js';
import Node from '../../domain/node/Node.js';
import { createDummyPublicKey } from '../../domain/node/__fixtures__/createDummyPublicKey.js';
import { createDummyOrganizationId } from '../../domain/organization/__fixtures__/createDummyOrganizationId.js';
import Organization from '../../domain/organization/Organization.js';
import { OrganizationValidators } from '../../domain/organization/OrganizationValidators.js';
import { NodeMeasurementAverage } from '../../domain/node/NodeMeasurementAverage.js';
import { NodeV1DTOMapper } from '../../mappers/NodeV1DTOMapper.js';
import type { NetworkScanRepository } from '../../domain/network/scan/NetworkScanRepository.js';

describe('NodeDTOService', () => {
	it('should return a list of NodeDTOs', async () => {
		const nodeMeasurementRepository = mock<NodeMeasurementRepository>();
		const nodeMeasurementDayRepository = mock<NodeMeasurementDayRepository>();
		const nodeMapper = mock<NodeV1DTOMapper>();
		const nodeDTOService = new NodeDTOService(
			nodeMeasurementRepository,
			nodeMeasurementDayRepository,
			nodeMapper,
			mock<NetworkScanRepository>()
		);

		const time = new Date();
		const nodeA = Node.create(time, createDummyPublicKey(), {
			ip: 'localhost',
			port: 1234
		});
		const nodeA24HourAvg = createNodeMeasurementAverage(
			nodeA.publicKey.value,
			1
		);
		const nodeA30DayAvg = createNodeMeasurementAverage(
			nodeA.publicKey.value,
			2
		);

		const nodeB = Node.create(time, createDummyPublicKey(), {
			ip: 'localhost',
			port: 1235
		});
		const nodeB24HourAvg = createNodeMeasurementAverage(
			nodeB.publicKey.value,
			3
		);
		const nodeB30DayAvg = createNodeMeasurementAverage(
			nodeB.publicKey.value,
			4
		);

		const organization = Organization.create(
			createDummyOrganizationId(),
			'home',
			time
		);
		organization.updateValidators(
			new OrganizationValidators([nodeA.publicKey]),
			time
		);

		nodeMeasurementRepository.findXDaysAverageAt.mockResolvedValue([
			nodeA24HourAvg,
			nodeB24HourAvg
		]);
		nodeMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue([
			nodeA30DayAvg,
			nodeB30DayAvg
		]);

		const nodeDTOsOrError = await nodeDTOService.getNodeDTOs(
			time,
			[nodeA, nodeB],
			[organization]
		);
		expect(nodeDTOsOrError.isOk()).toBe(true);
		expect(nodeMapper.toNodeV1DTO).toHaveBeenCalledTimes(2);
		expect(nodeMapper.toNodeV1DTO).toHaveBeenCalledWith(
			time,
			nodeA,
			nodeA24HourAvg,
			nodeA30DayAvg,
			organization.organizationId.value
		);
		expect(nodeMapper.toNodeV1DTO).toHaveBeenCalledWith(
			time,
			nodeB,
			nodeB24HourAvg,
			nodeB30DayAvg,
			undefined
		);
		expect(
			nodeMeasurementDayRepository.findXDaysAverageAt
		).toHaveBeenCalledWith(time, 30);
	});

	it('should return error if fetching 24H averages throws error', async function () {
		const nodeMeasurementRepository = mock<NodeMeasurementRepository>();
		nodeMeasurementRepository.findXDaysAverageAt.mockImplementation(() => {
			throw new Error('error');
		});
		const nodeMeasurementDayRepository = mock<NodeMeasurementDayRepository>();
		nodeMeasurementDayRepository.findXDaysAverageAt.mockResolvedValue([]);

		const nodeMapper = mock<NodeV1DTOMapper>();
		const nodeDTOService = new NodeDTOService(
			nodeMeasurementRepository,
			nodeMeasurementDayRepository,
			nodeMapper,
			mock<NetworkScanRepository>()
		);

		const time = new Date();
		const nodeA = Node.create(time, createDummyPublicKey(), {
			ip: 'localhost',
			port: 1234
		});

		const result = await nodeDTOService.getNodeDTOs(time, [nodeA], []);
		expect(result.isErr()).toBe(true);
	});

	it('should return error if fetching 30D averages throws error', async function () {
		const nodeMeasurementRepository = mock<NodeMeasurementRepository>();
		nodeMeasurementRepository.findXDaysAverageAt.mockResolvedValue([]);

		const nodeMeasurementDayRepository = mock<NodeMeasurementDayRepository>();
		nodeMeasurementDayRepository.findXDaysAverageAt.mockImplementation(() => {
			throw new Error('error');
		});

		const nodeMapper = mock<NodeV1DTOMapper>();
		const nodeDTOService = new NodeDTOService(
			nodeMeasurementRepository,
			nodeMeasurementDayRepository,
			nodeMapper,
			mock<NetworkScanRepository>()
		);

		const time = new Date();
		const nodeA = Node.create(time, createDummyPublicKey(), {
			ip: 'localhost',
			port: 1234
		});

		const result = await nodeDTOService.getNodeDTOs(time, [nodeA], []);
		expect(result.isErr()).toBe(true);
	});

	it('anchors known-page statistics to a completed scan and shares them across request times', async () => {
		const day = mock<NodeMeasurementRepository>();
		const month = mock<NodeMeasurementDayRepository>();
		const scans = mock<NetworkScanRepository>();
		const mapper = mock<NodeV1DTOMapper>();
		const scanTime = new Date('2026-10-04T03:00:00Z');
		const generatedAt = new Date('2026-10-04T03:01:00Z');
		const nextRequest = new Date('2026-10-04T03:02:00Z');
		scans.findLatestSuccessfulScanTime.mockResolvedValue(scanTime);
		day.findXDaysAverageAt.mockResolvedValue([]);
		month.findXDaysAverageAt.mockResolvedValue([]);
		const service = new NodeDTOService(day, month, mapper, scans);
		const node = Node.create(scanTime, createDummyPublicKey(), {
			ip: 'localhost',
			port: 1234
		});
		await Promise.all([
			service.getCurrentNodeDTOs(generatedAt, [node], []),
			service.getCurrentNodeDTOs(nextRequest, [node], [])
		]);
		expect(day.findXDaysAverageAt).toHaveBeenCalledTimes(1);
		expect(month.findXDaysAverageAt).toHaveBeenCalledTimes(1);
		expect(month.findXDaysAverageAt).toHaveBeenCalledWith(scanTime, 30);
		expect(mapper.toNodeV1DTO).toHaveBeenCalledWith(
			generatedAt,
			node,
			undefined,
			undefined,
			undefined
		);
		expect(mapper.toNodeV1DTO).toHaveBeenCalledWith(
			nextRequest,
			node,
			undefined,
			undefined,
			undefined
		);
		scans.findLatestSuccessfulScanTime.mockResolvedValue(
			new Date('2026-10-04T03:03:00Z')
		);
		await service.getCurrentNodeDTOs(nextRequest, [node], []);
		expect(month.findXDaysAverageAt).toHaveBeenCalledTimes(2);
	});

	it('does not query availability without completed scan evidence', async () => {
		const day = mock<NodeMeasurementRepository>();
		const month = mock<NodeMeasurementDayRepository>();
		const scans = mock<NetworkScanRepository>();
		scans.findLatestSuccessfulScanTime.mockResolvedValue(undefined);
		const service = new NodeDTOService(
			day,
			month,
			mock<NodeV1DTOMapper>(),
			scans
		);
		expect((await service.getCurrentNodeDTOs(new Date(), [], [])).isOk()).toBe(
			true
		);
		expect(day.findXDaysAverageAt).not.toHaveBeenCalled();
		expect(month.findXDaysAverageAt).not.toHaveBeenCalled();
	});

	function createNodeMeasurementAverage(
		publicKey: string,
		value: number
	): NodeMeasurementAverage {
		return {
			publicKey: publicKey,
			activeAvg: value,
			validatingAvg: value,
			historyArchiveErrorAvg: value,
			indexAvg: value,
			overLoadedAvg: value,
			fullValidatorAvg: value
		};
	}
});
