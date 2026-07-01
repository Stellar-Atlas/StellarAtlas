import { PeerNode } from './peer-node.js';
import type { Ledger } from './crawler.js';

export interface CrawlResult {
	peers: Map<string, PeerNode>;
	closedLedgers: bigint[];
	latestClosedLedger: Ledger;
}
