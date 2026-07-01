import { Node } from '../../core/index.js';
import { Statement } from './Statement.js';
import { Vote } from './Vote.js';

export enum FederatedVotingPhase {
	unknown = 'unknown',
	accepted = 'accepted',
	confirmed = 'confirmed'
}

export class FederatedVotingProtocolState {
	public processedVotes: Vote[] = [];
	public voted: Statement | null = null;
	public accepted: Statement | null = null;
	public confirmed: Statement | null = null;
	public phase: FederatedVotingPhase = FederatedVotingPhase.unknown;

	constructor(public readonly node: Node) {}
}
