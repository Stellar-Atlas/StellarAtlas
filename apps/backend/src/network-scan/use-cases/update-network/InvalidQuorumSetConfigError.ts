import { CustomError } from '../../../core/errors/CustomError.js';

export class InvalidQuorumSetConfigError extends CustomError {
	constructor() {
		super('Invalid quorum set configuration', InvalidQuorumSetConfigError.name);
	}
}
