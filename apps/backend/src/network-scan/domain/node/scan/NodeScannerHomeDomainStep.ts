import { HomeDomainFetcher } from './HomeDomainFetcher.js';
import { injectable } from 'inversify';
import { NodeScan } from './NodeScan.js';

@injectable()
export class NodeScannerHomeDomainStep {
	constructor(private homeDomainFetcher: HomeDomainFetcher) {}

	public async execute(nodeScan: NodeScan): Promise<void> {
		nodeScan.updateHomeDomains(
			await this.homeDomainFetcher.fetchHomeDomains(nodeScan.getPublicKeys())
		);
	}
}
