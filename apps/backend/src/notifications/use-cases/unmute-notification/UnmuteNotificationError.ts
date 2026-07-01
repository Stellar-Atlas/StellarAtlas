import { CustomError } from '../../../core/errors/CustomError.js';

export class UnmuteNotificationError extends CustomError {
	errorType = 'UnmuteNotificationError';
}

export class PersistenceError extends UnmuteNotificationError {
	constructor(cause: Error) {
		super(`Persistence error`, PersistenceError.name, cause);
	}
}
