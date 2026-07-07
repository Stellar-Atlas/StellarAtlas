import { CustomError } from 'custom-error';

export class CoordinatorServiceError extends CustomError {
	constructor(message: string, cause?: Error) {
		super(message, CoordinatorServiceError.name, cause);
	}
}
