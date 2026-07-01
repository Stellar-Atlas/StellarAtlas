import { PublicKey } from '../index.js';
import { QuorumSet } from '../core/QuorumSet.js';
import { FederatedVotingPhase } from '../federated-voting/protocol/FederatedVotingProtocolState.js';
import { StatementDTO } from './StatementDTO.js';

export interface FederatedVoteDTO {
	publicKey: PublicKey;
	quorumSet?: QuorumSet;
	confirmed: StatementDTO | null;
	voted: StatementDTO | null;
	accepted: StatementDTO | null;
	phase: FederatedVotingPhase;
}
