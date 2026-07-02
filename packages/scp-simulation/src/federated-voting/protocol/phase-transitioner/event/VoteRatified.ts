import { PublicKey } from '@core/index.js';
import { QuorumSet } from '@core/QuorumSet.js';
import { ProtocolEvent } from '../../event/ProtocolEvent.js';
import { Statement } from '../../Statement.js';

export class VoteRatified extends ProtocolEvent {
	readonly subType = 'VoteRatified';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly statement: Statement,
		public readonly quorum: Map<string, QuorumSet>
	) {
		super(publicKey);
	}

	toString(): string {
		return `vote(${this.statement.toString()}) ratified by quorum (${Array.from(
			this.quorum.keys()
		)})`;
	}
}
