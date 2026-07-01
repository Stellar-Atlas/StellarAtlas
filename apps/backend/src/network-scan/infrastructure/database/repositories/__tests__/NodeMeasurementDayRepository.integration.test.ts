import { Container } from 'inversify';
import Kernel from '../../../../../core/infrastructure/Kernel';
import { ConfigMock } from '../../../../../core/config/__mocks__/configMock';
import { NETWORK_TYPES } from '../../../di/di-types';
import { NodeMeasurementDayRepository } from '../../../../domain/node/NodeMeasurementDayRepository';
import NodeMeasurementDay from '../../../../domain/node/NodeMeasurementDay';
import { createDummyNode } from '../../../../domain/node/__fixtures__/createDummyNode';
import { NodeRepository } from '../../../../domain/node/NodeRepository';
import NodeQuorumSet from '../../../../domain/node/NodeQuorumSet';
import { QuorumSet } from 'shared';
import NetworkScan from '../../../../domain/network/scan/NetworkScan';
import NetworkMeasurement from '../../../../domain/network/NetworkMeasurement';
import { NetworkScanRepository } from '../../../../domain/network/scan/NetworkScanRepository';
import { NodeMeasurementRepository } from '../../../../domain/node/NodeMeasurementRepository';
import NodeMeasurement from '../../../../domain/node/NodeMeasurement';

describe('test queries', () => {
	let container: Container;
	let kernel: Kernel;
	let nodeMeasurementDayRepository: NodeMeasurementDayRepository;
	let nodeRepository: NodeRepository;
	jest.setTimeout(60000); //slow integration tests

	beforeEach(async () => {
		kernel = await Kernel.getInstance(new ConfigMock());
		container = kernel.container;
		nodeMeasurementDayRepository = container.get<NodeMeasurementDayRepository>(
			NETWORK_TYPES.NodeMeasurementDayRepository
		);
		nodeRepository = container.get(NETWORK_TYPES.NodeRepository);
	});

	afterEach(async () => {
		await kernel.close();
	});

	test('findBetween', async () => {
		const idA = createDummyNode();
		const idB = createDummyNode();
		await nodeRepository.save([idA, idB], new Date('12/12/2020'));
		await nodeMeasurementDayRepository.save([
			new NodeMeasurementDay(idA, '12/12/2020'),
			new NodeMeasurementDay(idB, '12/12/2020'),
			new NodeMeasurementDay(idA, '12/13/2020'),
			new NodeMeasurementDay(idB, '12/13/2020')
		]);

		const measurements = await nodeMeasurementDayRepository.findBetween(
			idA.publicKey,
			new Date('12/12/2020'),
			new Date('12/13/2020')
		);
		expect(measurements.length).toEqual(2);
	});

	test('findXDaysAverageAt', async () => {
		const idA = createDummyNode();
		await nodeRepository.save([idA], new Date('12/12/2020'));
		const a = new NodeMeasurementDay(idA, '12/12/2020');
		a.crawlCount = 2;
		a.isValidatingCount = 2;
		const b = new NodeMeasurementDay(idA, '12/13/2020');
		b.crawlCount = 2;
		b.isValidatingCount = 2;
		await nodeMeasurementDayRepository.save([a, b]);

		const averages = await nodeMeasurementDayRepository.findXDaysAverageAt(
			new Date('12/13/2020'),
			2
		);
		expect(averages.length).toEqual(1);
		expect(averages[0].validatingAvg).toEqual(100);
		expect(averages[0].publicKey).toEqual(idA.publicKey.value);
	});

	test('findXDaysActiveButNotValidating', async () => {
		const nodeToDemote = createDummyNode(
			'localhost',
			1126,
			new Date('11/11/2020')
		);
		nodeToDemote.updateQuorumSet(
			NodeQuorumSet.create('key', new QuorumSet(1, [], [])),
			new Date('12/11/2020')
		);
		const validatingNode = createDummyNode();
		await nodeRepository.save(
			[nodeToDemote, validatingNode],
			new Date('12/12/2019')
		);
		const a = new NodeMeasurementDay(nodeToDemote, '12/12/2020');
		a.crawlCount = 2;
		a.isValidatingCount = 0;
		a.isActiveCount = 2;
		const b = new NodeMeasurementDay(validatingNode, '12/12/2020');
		b.crawlCount = 2;
		b.isValidatingCount = 2;
		b.isActiveCount = 2;
		await nodeMeasurementDayRepository.save([a, b]);

		const publicKeys =
			await nodeMeasurementDayRepository.findXDaysActiveButNotValidating(
				new Date('12/12/2020'),
				2
			);

		expect(publicKeys.length).toEqual(1);
		expect(publicKeys[0].publicKey).toEqual(nodeToDemote.publicKey.value);
	});

	test('findXDaysInactive', async () => {
		const activeNode = createDummyNode(
			'localhost',
			1126,
			new Date('11/11/2020')
		);

		const activeNodeDayMeasurement = new NodeMeasurementDay(
			activeNode,
			'12/12/2020'
		);
		activeNodeDayMeasurement.crawlCount = 2;
		activeNodeDayMeasurement.isValidatingCount = 0;
		activeNodeDayMeasurement.isActiveCount = 2;

		const inActiveNode = createDummyNode(
			'localhost',
			1127,
			new Date('11/11/2020')
		);
		const inActiveNodeDayMeasurement = new NodeMeasurementDay(
			inActiveNode,
			'12/12/2020'
		);
		inActiveNodeDayMeasurement.crawlCount = 2;
		inActiveNodeDayMeasurement.isValidatingCount = 0;
		inActiveNodeDayMeasurement.isActiveCount = 0;

		await nodeRepository.save(
			[activeNode, inActiveNode],
			new Date('12/12/2019')
		);

		await nodeMeasurementDayRepository.save([
			activeNodeDayMeasurement,
			inActiveNodeDayMeasurement
		]);

		const publicKeys = await nodeMeasurementDayRepository.findXDaysInactive(
			new Date('12/12/2020'),
			7
		);

		expect(publicKeys.length).toEqual(1);
		expect(publicKeys[0].publicKey).toEqual(inActiveNode.publicKey.value);
	});

	test('rollup is idempotent for affected days', async () => {
		const scanRepository = container.get<NetworkScanRepository>(
			NETWORK_TYPES.NetworkScanRepository
		);
		const nodeMeasurementRepository = container.get<NodeMeasurementRepository>(
			NETWORK_TYPES.NodeMeasurementRepository
		);
		const node = createDummyNode();
		const scanTime1 = new Date(Date.UTC(2020, 0, 3, 0));
		const scanTime2 = new Date(Date.UTC(2020, 0, 3, 1));
		await nodeRepository.save([node], scanTime1);

		const scan1 = new NetworkScan(scanTime1);
		scan1.id = 1;
		scan1.completed = true;
		scan1.measurement = new NetworkMeasurement(scanTime1);
		const measurement1 = new NodeMeasurement(scanTime1, node);
		measurement1.isActive = true;
		measurement1.isValidating = true;
		measurement1.isFullValidator = true;
		measurement1.index = 1;
		await scanRepository.save([scan1]);
		await nodeMeasurementRepository.save([measurement1]);

		await nodeMeasurementDayRepository.rollup(1, 1);
		let measurements = await nodeMeasurementDayRepository.findBetween(
			node.publicKey,
			scanTime1,
			scanTime1
		);
		expect(measurements[0].crawlCount).toEqual(1);
		expect(measurements[0].isActiveCount).toEqual(1);

		const scan2 = new NetworkScan(scanTime2);
		scan2.id = 2;
		scan2.completed = true;
		scan2.measurement = new NetworkMeasurement(scanTime2);
		const measurement2 = new NodeMeasurement(scanTime2, node);
		measurement2.isActive = false;
		measurement2.isValidating = false;
		measurement2.index = 2;
		await scanRepository.save([scan2]);
		await nodeMeasurementRepository.save([measurement2]);

		await nodeMeasurementDayRepository.rollup(2, 2);
		await nodeMeasurementDayRepository.rollup(2, 2);
		measurements = await nodeMeasurementDayRepository.findBetween(
			node.publicKey,
			scanTime1,
			scanTime1
		);
		expect(measurements[0].crawlCount).toEqual(2);
		expect(measurements[0].isActiveCount).toEqual(1);
		expect(measurements[0].isValidatingCount).toEqual(1);
		expect(measurements[0].indexSum).toEqual(3);
	});
});
