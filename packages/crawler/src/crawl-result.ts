import { PeerNode } from './peer-node.js';
import type { Ledger } from './crawler.js';
import type { ScpStatementObservation } from './network-observer/scp-statement-observation.js';

export interface CrawlResult {
	peers: Map<string, PeerNode>;
	closedLedgers: bigint[];
	latestClosedLedger: Ledger;
	scpStatementObservations: ScpStatementObservation[];
}
