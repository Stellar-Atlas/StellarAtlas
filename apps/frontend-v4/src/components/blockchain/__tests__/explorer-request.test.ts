import { jest } from '@jest/globals';
import { executeExplorerRequest, withExplorerRequestDeadline } from '../explorer-request';

describe('explorer request containment', () => {
	it('returns loaded data unchanged', async () => {
		const value = { status: 'loaded', records: ['one'] };
		await expect(
			executeExplorerRequest(async () => value, 'Unavailable')
		).resolves.toEqual({ ok: true, value });
	});

	it('contains thrown action errors without exposing internal details', async () => {
		await expect(
			executeExplorerRequest(async () => {
				throw new Error('internal transport stack and credentials');
			}, 'Search could not be completed.')
		).resolves.toEqual({
			ok: false,
			message: 'Search could not be completed.'
		});
	});

	it('does not supply replacement data when a refresh is unavailable', async () => {
		const result = await executeExplorerRequest(
			async () => ({
				status: 'unavailable',
				message: 'Indexer is catching up.',
				records: null
			}),
			'Unavailable'
		);
		expect(result).toEqual({ ok: false, message: 'Indexer is catching up.' });
		expect(result).not.toHaveProperty('value');
	});

	it('keeps invalid query feedback as a displayable action result', async () => {
		const value = { status: 'invalid', message: 'Enter a transaction hash.' };
		await expect(
			executeExplorerRequest(async () => value, 'Unavailable')
		).resolves.toEqual({ ok: true, value });
	});

	it('provides a safe retry message when the API omits one', async () => {
		await expect(
			executeExplorerRequest(
				async () => ({
					status: 'unavailable',
					message: null
				}),
				'Unavailable'
			)
		).resolves.toEqual({
			ok: false,
			message: 'The data service is unavailable. Please try again.'
		});
	});

	it('distinguishes the local balance deadline from API failure and ordinary cancellation', async () => {
		jest.useFakeTimers();
		try {
			const generic = 'Parsed balances are temporarily unavailable. Try this request again.';
			const timed = new AbortController();
			const waitForAbort = (controller: AbortController) => new Promise<never>((_, reject) =>
				controller.signal.addEventListener('abort', () => reject(new DOMException('Stopped', 'AbortError')), { once: true })
			);
			const pending = executeExplorerRequest(() =>
				withExplorerRequestDeadline(timed, 25_000, () => waitForAbort(timed)), generic);
			await jest.advanceTimersByTimeAsync(24_999);
			expect(timed.signal.aborted).toBe(false);
			await jest.advanceTimersByTimeAsync(1);
			await expect(pending).resolves.toEqual({
				ok: false, message: 'This request timed out in the browser after 25 seconds. Try again.'
			});

			const canceled = new AbortController();
			const navigation = executeExplorerRequest(() =>
				withExplorerRequestDeadline(canceled, 25_000, () => waitForAbort(canceled)), generic);
			canceled.abort();
			await expect(navigation).resolves.toEqual({ ok: false, message: generic });

			const failed = new AbortController();
			await expect(executeExplorerRequest(() =>
				withExplorerRequestDeadline(failed, 25_000, async () => {
					throw new Error('HTTP 503: internal transport detail');
				}), generic)).resolves.toEqual({ ok: false, message: generic });
			await jest.advanceTimersByTimeAsync(25_000);
			expect(failed.signal.aborted).toBe(false);
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.useRealTimers();
		}
	});
});
