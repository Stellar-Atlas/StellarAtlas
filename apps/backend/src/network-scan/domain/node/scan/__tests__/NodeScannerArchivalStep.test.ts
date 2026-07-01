import { NodeScannerHistoryArchiveStep } from '../NodeScannerHistoryArchiveStep.js';
import { mock } from 'jest-mock-extended';
import { NodeScan } from '../NodeScan.js';
import { NodeScannerArchivalStep } from '../NodeScannerArchivalStep.js';
import { InactiveNodesArchiver } from '../../archival/InactiveNodesArchiver.js';
import { ValidatorDemoter } from '../../archival/ValidatorDemoter.js';

describe('NodeScannerHistoryArchiveStep', () => {
	const inactiveNodesArchiver = mock<InactiveNodesArchiver>();
	const validatorDemoter = mock<ValidatorDemoter>();
	const nodeScannerArchivalStep = new NodeScannerArchivalStep(
		validatorDemoter,
		inactiveNodesArchiver
	);

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should archive', async () => {
		const nodeScan = mock<NodeScan>();
		await nodeScannerArchivalStep.execute(nodeScan);
		expect(validatorDemoter.demote).toHaveBeenCalledTimes(1);
		expect(inactiveNodesArchiver.archive).toHaveBeenCalledTimes(1);
	});
});
