import { Observation } from './observation.js';
import type { NodeAddress } from '../node-address.js';
import { PeerNodeCollection } from '../peer-node-collection.js';
import { Slots } from './peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots.js';
import { QuorumSet } from 'shared';
import type { Ledger } from '../crawler.js';
import type { ScpStatementObservationListener } from './observation.js';

export class ObservationFactory {
	public createObservation(
		network: string,
		slots: Slots,
		topTierAddresses: NodeAddress[],
		peerNodes: PeerNodeCollection,
		latestConfirmedClosedLedger: Ledger,
		quorumSets: Map<string, QuorumSet>,
		onScpStatementObservation?: ScpStatementObservationListener
	): Observation {
		return new Observation(
			network,
			topTierAddresses,
			peerNodes,
			latestConfirmedClosedLedger,
			quorumSets,
			slots,
			onScpStatementObservation
		);
	}
}
