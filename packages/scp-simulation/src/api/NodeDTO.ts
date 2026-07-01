import { PublicKey } from '../index.js';
import { QuorumSet } from '../core/QuorumSet.js';
import { FederatedVoteDTO } from './FederatedVoteDTO.js';

export interface NodeDTO {
	publicKey: string;
	quorumSet?: QuorumSet;
	connections: PublicKey[];
	federatedVotingState: FederatedVoteDTO;
}
