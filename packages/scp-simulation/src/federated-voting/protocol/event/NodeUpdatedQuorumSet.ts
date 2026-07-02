import { PublicKey, QuorumSet } from '@core/index.js';
import { ProtocolEvent } from './ProtocolEvent.js';

//todo: is this a ProtocolEvent??
export class NodeUpdatedQuorumSet extends ProtocolEvent {
	readonly subType = 'NodeUpdatedQuorumSet';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly quorumSet: QuorumSet
	) {
		super(publicKey);
	}

	toString(): string {
		return `${this.publicKey}:updated to quorumSet(${this.quorumSet.toString()})`;
	}
}
