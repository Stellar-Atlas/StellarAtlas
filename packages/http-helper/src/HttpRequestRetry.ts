import { HttpError, type HttpResponse } from './HttpService.js';
import { Result } from 'neverthrow';
import { asyncSleep } from './asyncSleep.js';

export async function retryHttpRequestIfNeeded<Args extends unknown[]>(
	amount: number,
	sleepMs: number,
	httpAction: (
		...httpActionParameters: Args
	) => Promise<Result<HttpResponse, HttpError>>,
	...parameters: Args
): Promise<Result<HttpResponse, HttpError>> {
	let count = 1;
	let result = await httpAction(...parameters);
	while (count < amount && retryNeeded(result)) {
		//exponential backoff
		await asyncSleep(Math.pow(2, count) * sleepMs);
		count++;
		result = await httpAction(...parameters);
	}

	return result;
}

function retryNeeded(result: Result<HttpResponse, HttpError>) {
	if (result.isErr()) {
		const status = result.error.response?.status;
		// A missing/forbidden object is not made available by immediate retries.
		// Request timeout, too-early and rate limiting remain transient responses.
		if (status !== undefined) {
			return (
				status === 408 ||
				status === 425 ||
				status === 429 ||
				(status >= 500 && status < 600)
			);
		}
		return result.error.code !== 'ERR_CANCELED';
	}

	return false;
}
