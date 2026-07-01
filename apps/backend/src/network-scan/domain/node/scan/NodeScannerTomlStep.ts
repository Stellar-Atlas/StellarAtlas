import { injectable } from 'inversify';
import { NodeScan } from './NodeScan.js';
import { NodeTomlFetcher } from './NodeTomlFetcher.js';

@injectable()
export class NodeScannerTomlStep {
	constructor(private nodeTomlFetcher: NodeTomlFetcher) {}

	public async execute(nodeScan: NodeScan): Promise<void> {
		nodeScan.updateWithTomlInfo(
			await this.nodeTomlFetcher.fetchNodeTomlInfoCollection(
				nodeScan.getHomeDomains()
			)
		);
	}
}
