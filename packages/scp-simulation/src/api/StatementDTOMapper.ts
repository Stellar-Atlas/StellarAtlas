import { Statement } from '../federated-voting/protocol/index.js';
import { StatementDTO } from './StatementDTO.js';

export class StatementDTOMapper {
	static toStatementDTO(statement: Statement): StatementDTO {
		return {
			value: statement.toString()
		};
	}
}
