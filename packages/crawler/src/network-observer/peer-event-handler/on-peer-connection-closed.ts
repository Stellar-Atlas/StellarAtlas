import { ClosePayload } from '../connection-manager.js';
import { truncate } from '../../utilities/truncate.js';
import { QuorumSetManager } from '../quorum-set-manager.js';
import pino from 'pino';
import { Observation } from '../observation.js';

export class OnPeerConnectionClosed {
	constructor(
		private quorumSetManager: QuorumSetManager,
		private logger: pino.Logger
	) {}

	public handle(data: ClosePayload, observation: Observation) {
		this.logIfTopTierDisconnect(data, observation.topTierAddressesSet);
		if (data.publicKey) {
			this.quorumSetManager.onNodeDisconnected(data.publicKey, observation);
		}
	}

	private logIfTopTierDisconnect(
		data: ClosePayload,
		topTierAddresses: Set<string>
	) {
		if (topTierAddresses.has(data.address)) {
			this.logger.debug(
				{ pk: truncate(data.publicKey), address: data.address },
				'Top tier node disconnected'
			);
		}
	}
}
