import { PublicKey } from '@core/index.js';
import { ProtocolEvent } from '../../event/ProtocolEvent.js';
import { Statement } from '../../Statement.js';

export class AcceptVoteVBlocked extends ProtocolEvent {
	readonly subType = 'AcceptVoteVBlocked';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly statement: Statement,
		public readonly vBlockingSet: Set<PublicKey>
	) {
		super(publicKey);
	}

	toString(): string {
		return `Accept(${this.statement}) votes from ${Array.from(this.vBlockingSet)} are v-blocking`;
	}
}
