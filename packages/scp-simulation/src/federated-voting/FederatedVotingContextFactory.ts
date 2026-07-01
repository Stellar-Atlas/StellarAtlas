import { Overlay } from '../overlay/index.js';
import { FederatedVotingContext } from './FederatedVotingContext.js';
import { FederatedVotingProtocol } from './protocol/FederatedVotingProtocol.js';
import { PhaseTransitioner } from './protocol/phase-transitioner/PhaseTransitioner.js';

export class FederatedVotingContextFactory {
	static create(
		overlayFullyConnected = true,
		overlayGossipEnabled = false
	): FederatedVotingContext {
		return new FederatedVotingContext(
			new FederatedVotingProtocol(new PhaseTransitioner()),
			new Overlay(overlayFullyConnected, overlayGossipEnabled)
		);
	}
}
