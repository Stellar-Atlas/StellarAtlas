import { CustomError } from '@core/errors/CustomError.js';

export class InvalidUpdateTimeError extends CustomError {
	constructor() {
		super('Invalid update time', InvalidUpdateTimeError.name);
	}
}
