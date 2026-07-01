import { FederatedVotingProtocolState } from '../federated-voting/protocol/FederatedVotingProtocolState.js';
import { FederatedVoteDTO } from './FederatedVoteDTO.js';
import { StatementDTOMapper } from './StatementDTOMapper.js';

export class FederatedVoteDTOMapper {
	static toDTO(
		federatedVotingState: FederatedVotingProtocolState,
		includeQSet = false
	): FederatedVoteDTO {
		return {
			publicKey: federatedVotingState.node.publicKey,
			quorumSet: includeQSet ? federatedVotingState.node.quorumSet : undefined,
			confirmed: federatedVotingState.confirmed
				? StatementDTOMapper.toStatementDTO(federatedVotingState.confirmed)
				: null,
			phase: federatedVotingState.phase,
			voted: federatedVotingState.voted
				? StatementDTOMapper.toStatementDTO(federatedVotingState.voted)
				: null,
			accepted: federatedVotingState.accepted
				? StatementDTOMapper.toStatementDTO(federatedVotingState.accepted)
				: null
		};
	}
}
