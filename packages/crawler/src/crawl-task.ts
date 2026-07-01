import type { NodeAddress } from './node-address.js';
import { Crawl } from './crawl.js';

export interface CrawlTask {
	nodeAddress: NodeAddress;
	crawl: Crawl;
	connectCallback: () => void;
}
