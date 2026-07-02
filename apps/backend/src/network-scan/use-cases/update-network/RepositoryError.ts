import { CustomError } from '@core/errors/CustomError.js';

export class RepositoryError extends CustomError {
	constructor(id: string) {
		super(
			`Error fetching or persisting config for network ${id}`,
			RepositoryError.name
		);
	}
}
