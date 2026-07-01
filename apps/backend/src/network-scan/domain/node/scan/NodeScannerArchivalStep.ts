import { injectable } from 'inversify';
import { NodeScan } from './NodeScan.js';
import { ValidatorDemoter } from '../archival/ValidatorDemoter.js';
import { InactiveNodesArchiver } from '../archival/InactiveNodesArchiver.js';
import { TrustGraphFactory } from './TrustGraphFactory.js';

@injectable()
export class NodeScannerArchivalStep {
	constructor(
		private validatorDemoter: ValidatorDemoter,
		private inactiveNodesArchiver: InactiveNodesArchiver
	) {}

	public async execute(nodeScan: NodeScan): Promise<void> {
		const trustGraph = TrustGraphFactory.create(nodeScan.nodes);
		await this.validatorDemoter.demote(nodeScan, trustGraph, 2);
		await this.inactiveNodesArchiver.archive(nodeScan, trustGraph, 2);
	}
}
