import { CustomError } from '@core/errors/CustomError.js';

export class InvalidOverlayRangeError extends CustomError {
	constructor() {
		super('Invalid overlay range', InvalidOverlayRangeError.name);
	}
}
