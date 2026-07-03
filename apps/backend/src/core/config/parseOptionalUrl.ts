import { err, ok, Result } from 'neverthrow';
import { Url } from '../domain/Url.js';
import { isString } from '../utilities/TypeGuards.js';

export function parseOptionalUrl(
	value: string | undefined
): Result<Url | undefined, Error> {
	if (!isString(value) || value.trim().length === 0) return ok(undefined);
	const result = Url.create(value.trim());
	if (result.isErr()) return err(result.error);
	return ok(result.value);
}
