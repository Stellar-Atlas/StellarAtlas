import { mock } from 'jest-mock-extended';
import { NodeScannerTomlStep } from '../NodeScannerTomlStep.js';
import { NodeScan } from '../NodeScan.js';
import { NodeTomlInfo } from '../NodeTomlInfo.js';
import { NodeTomlFetcher } from '../NodeTomlFetcher.js';

describe('NodeScannerTomlStep', () => {
	const nodeTomlFetcher = mock<NodeTomlFetcher>();
	const step = new NodeScannerTomlStep(nodeTomlFetcher);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should update with toml info', async function () {
		const nodeScan = mock<NodeScan>();
		const tomlInfo = new Set<NodeTomlInfo>();
		nodeTomlFetcher.fetchNodeTomlInfoCollection.mockResolvedValue(tomlInfo);
		await step.execute(nodeScan);
		expect(nodeTomlFetcher.fetchNodeTomlInfoCollection).toHaveBeenCalled();
		expect(nodeScan.updateWithTomlInfo).toHaveBeenCalledWith(tomlInfo);
	});
});
