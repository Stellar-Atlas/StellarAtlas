import { isString } from './TypeGuards.js';

export function mapUnknownToError(e: unknown): Error {
	if (e instanceof Error) {
		return e;
	}
	if (isString(e)) {
		return new Error(e);
	}

	return new Error('Unspecified error: ' + e);
}
