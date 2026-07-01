import { NodeScannerIndexerStep } from '../NodeScannerIndexerStep.js';
import { NodeScan } from '../NodeScan.js';
import { createDummyNode } from '../../__fixtures__/createDummyNode.js';
import { StellarCoreVersion } from '../../../network/StellarCoreVersion.js';
import 'reflect-metadata';
import NodeMeasurement from '../../NodeMeasurement.js';

describe('NodeScannerIndexerStep', () => {
	const step = new NodeScannerIndexerStep();
	const stellarCoreVersion = StellarCoreVersion.create('13.0.0');
	if (stellarCoreVersion.isErr()) throw new Error('stellarCoreVersion is Err');
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should update with indexer info', function () {
		const nodeScan = new NodeScan(new Date(), [createDummyNode()]);
		nodeScan.nodes[0].addMeasurement(
			new NodeMeasurement(new Date(), nodeScan.nodes[0])
		);
		step.execute(nodeScan, [], stellarCoreVersion.value);
		expect(nodeScan.nodes[0].latestMeasurement()?.index).toBeGreaterThan(0);
	});
});
