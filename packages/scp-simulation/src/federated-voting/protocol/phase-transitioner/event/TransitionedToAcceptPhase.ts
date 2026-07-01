import { PublicKey } from '../../../../core/index.js';
import { FederatedVotingPhase } from '../../FederatedVotingProtocolState.js';
import { ProtocolEvent } from '../../event/ProtocolEvent.js';
import { Statement } from '../../Statement.js';

export class TransitionedToAcceptPhase extends ProtocolEvent {
	readonly subType = 'TransitionedToAcceptPhase';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly phase: FederatedVotingPhase,
		public readonly statement: Statement
	) {
		super(publicKey);
	}

	toString(): string {
		return `${this.statement.toString()}`;
	}
}
