import { PublicKey } from '@core/index.js';
import { ProtocolEvent } from './ProtocolEvent.js';
import { Vote } from '../Vote.js';

export class Voted extends ProtocolEvent {
	readonly subType = 'Voted';
	constructor(
		public readonly publicKey: PublicKey,
		public readonly vote: Vote
	) {
		super(publicKey);
	}

	toString(): string {
		return `${this.vote.toString()}`;
	}
}
