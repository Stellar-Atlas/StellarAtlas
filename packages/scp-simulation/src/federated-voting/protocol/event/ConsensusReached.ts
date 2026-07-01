import { PublicKey } from '../../../core/index.js';
import { ProtocolEvent } from './ProtocolEvent.js';
import { Statement } from '../Statement.js';

export class ConsensusReached extends ProtocolEvent {
	readonly subType = 'ConsensusReached';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly statement: Statement
	) {
		super(publicKey);
	}

	toString(): string {
		return `Consensus reached on ${this.statement.toString()}`;
	}
}
