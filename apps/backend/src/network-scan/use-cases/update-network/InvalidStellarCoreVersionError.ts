import { CustomError } from '@core/errors/CustomError.js';

export class InvalidStellarCoreVersionError extends CustomError {
	constructor() {
		super('Invalid Stellar Core version', InvalidStellarCoreVersionError.name);
	}
}
