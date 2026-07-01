import {
	ClosePayload,
	ConnectedPayload,
	DataPayload
} from '../connection-manager.js';
import type { Ledger } from '../../crawler.js';
import type { NodeAddress } from '../../node-address.js';
import { OnPeerConnected } from './on-peer-connected.js';
import { OnPeerConnectionClosed } from './on-peer-connection-closed.js';
import { OnPeerData } from './on-peer-data.js';
import { Observation } from '../observation.js';

export class PeerEventHandler {
	constructor(
		private onConnectedHandler: OnPeerConnected,
		private onConnectionCloseHandler: OnPeerConnectionClosed,
		private onPeerDataHandler: OnPeerData
	) {}

	public onConnected(data: ConnectedPayload, observation: Observation) {
		this.onConnectedHandler.handle(data, observation);
	}

	public onConnectionClose(data: ClosePayload, observation: Observation) {
		this.onConnectionCloseHandler.handle(data, observation);
	}

	public onData(
		data: DataPayload,
		observation: Observation
	): {
		closedLedger: Ledger | null;
		peers: NodeAddress[];
	} {
		return this.onPeerDataHandler.handle(data, observation);
	}
}
