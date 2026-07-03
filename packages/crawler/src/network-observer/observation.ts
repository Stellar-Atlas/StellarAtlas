import type { NodeAddress } from '../node-address.js';
import { PeerNodeCollection } from '../peer-node-collection.js';
import assert from 'assert';
import type { Ledger } from '../crawler.js';
import { ObservationState } from './observation-state.js';
import { Slots } from './peer-event-handler/stellar-message-handlers/scp-envelope/scp-statement/externalize/slots.js';
import { QuorumSet } from 'shared';
import { QuorumSetState } from './quorum-set-state.js';
import { LRUCache } from 'lru-cache';
import type { ScpStatementObservation } from './scp-statement-observation.js';

export type ScpStatementObservationListener = (
	observation: ScpStatementObservation
) => void;

export class Observation {
	public state: ObservationState = ObservationState.Idle;
	private networkHalted = false;
	public topTierAddressesSet: Set<string>;
	public envelopeCache: LRUCache<string, number>;
	public quorumSetState: QuorumSetState = new QuorumSetState();
	public scpStatementObservations: ScpStatementObservation[] = [];

	constructor(
		public network: string,
		public topTierAddresses: NodeAddress[],
		public peerNodes: PeerNodeCollection,
		public latestConfirmedClosedLedger: Ledger,
		public quorumSets: Map<string, QuorumSet>,
		public slots: Slots,
		private onScpStatementObservation?: ScpStatementObservationListener
	) {
		this.topTierAddressesSet = this.mapTopTierAddresses(topTierAddresses);
		this.envelopeCache = new LRUCache<string, number>({ max: 5000 });
	}

	private mapTopTierAddresses(topTierNodes: NodeAddress[]) {
		const topTierAddresses = new Set<string>();
		topTierNodes.forEach((address) => {
			topTierAddresses.add(`${address[0]}:${address[1]}`);
		});
		return topTierAddresses;
	}

	moveToSyncingState() {
		assert(this.state === ObservationState.Idle);
		this.state = ObservationState.Syncing;
	}

	moveToSyncedState() {
		assert(this.state === ObservationState.Syncing);
		this.state = ObservationState.Synced;
	}

	moveToStoppingState() {
		assert(this.state !== ObservationState.Idle);
		this.state = ObservationState.Stopping;
	}

	moveToStoppedState() {
		assert(this.state === ObservationState.Stopping);
		this.state = ObservationState.Stopped;
	}

	ledgerCloseConfirmed(ledger: Ledger) {
		this.networkHalted = false;
		if (this.state !== ObservationState.Synced) return;

		this.latestConfirmedClosedLedger = ledger;
	}

	isNetworkHalted(): boolean {
		return this.networkHalted;
	}

	setNetworkHalted() {
		this.networkHalted = true;
	}

	recordScpStatementObservation(observation: ScpStatementObservation): void {
		this.scpStatementObservations.push(observation);
		this.onScpStatementObservation?.(observation);
	}
}
