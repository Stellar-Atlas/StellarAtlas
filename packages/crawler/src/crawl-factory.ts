import { Crawl } from './crawl.js';
import { ObservationFactory } from './network-observer/observation-factory.js';
import { Slots } from './network-observer/peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots.js';
import type { NodeAddress } from './node-address.js';
import { QuorumSet } from 'shared';
import type { Ledger } from './crawler.js';
import pino from 'pino';
import { PeerNodeCollection } from './peer-node-collection.js';

export class CrawlFactory {
	constructor(
		private observationFactory: ObservationFactory,
		private network: string,
		private logger: pino.Logger
	) {}
	public createCrawl(
		nodesToCrawl: NodeAddress[],
		topTierAddresses: NodeAddress[],
		topTierQuorumSet: QuorumSet,
		latestConfirmedClosedLedger: Ledger,
		quorumSets: Map<string, QuorumSet>
	): Crawl {
		const observation = this.observationFactory.createObservation(
			this.network,
			new Slots(topTierQuorumSet, this.logger),
			topTierAddresses,
			new PeerNodeCollection(),
			latestConfirmedClosedLedger,
			quorumSets
		);
		return new Crawl(nodesToCrawl, observation);
	}
}
