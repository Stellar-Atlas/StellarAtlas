import { CustomError } from '../../../core/errors/CustomError.js';

export class InvalidUrlError extends CustomError {
	constructor(url: string) {
		super(`Invalid url: ${url}`, InvalidUrlError.name);
	}
}
