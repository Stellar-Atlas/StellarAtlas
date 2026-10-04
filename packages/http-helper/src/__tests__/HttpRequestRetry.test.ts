import { err } from 'neverthrow';
import { HttpError } from '../HttpService.js';
import { retryHttpRequestIfNeeded } from '../HttpRequestRetry.js';

it.each([400, 401, 403, 404, 405, 410, 422])(
	'does not retry HTTP %i',
	async (status) => {
		const wrapped = createErrorAction('ERR_BAD_REQUEST', status);
		await retryHttpRequestIfNeeded(3, 0, wrapped.action);
		expect(wrapped.getCount()).toBe(1);
	}
);

it.each([408, 425, 429, 500, 503, 520])(
	'retains bounded retries for HTTP %i',
	async (status) => {
		const wrapped = createErrorAction('ERR_BAD_RESPONSE', status);
		await retryHttpRequestIfNeeded(3, 0, wrapped.action);
		expect(wrapped.getCount()).toBe(3);
	}
);

it('does not retry caller cancellation', async () => {
	const wrapped = createErrorAction('ERR_CANCELED');
	await retryHttpRequestIfNeeded(3, 0, wrapped.action);
	expect(wrapped.getCount()).toBe(1);
});

it('should retry the correct amount of times', async function () {
	const actionWrap = createErrorAction('500', 500);
	await retryHttpRequestIfNeeded(2, 400, actionWrap.action);

	expect(actionWrap.getCount()).toEqual(2);
});

it('should retry on timeout', async function () {
	const actionWrap = createErrorAction('ETIMEDOUT');
	await retryHttpRequestIfNeeded(3, 400, actionWrap.action);

	expect(actionWrap.getCount()).toEqual(3);
});

function createErrorAction(code: string, status?: number) {
	let counter = 0;
	const getCount = () => {
		return counter;
	};
	const action = async () => {
		counter++;
		return err(
			new HttpError(
				'message',
				code,
				status === undefined
					? undefined
					: {
							data: null,
							status: status,
							headers: [],
							statusText: 'text'
						}
			)
		);
	};

	return { getCount: getCount, action: action };
}
