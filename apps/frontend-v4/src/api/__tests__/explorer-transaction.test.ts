import { jest } from '@jest/globals';
import { requestExplorerTransaction } from '../explorer-transaction';
describe('ClickHouse transaction lookup', () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = originalFetch;
	});
	it('queries the parsed transaction API by hash without requiring the legacy index or a ledger hint', async () => {
		const fetchMock = jest
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(
					JSON.stringify({
						transaction: { hash: 'abc', ledgerSequence: 63490364 }
					}),
					{ status: 200 }
				)
			);
		globalThis.fetch = fetchMock;
		const result = await requestExplorerTransaction(
			'abc',
			'',
			{},
			new AbortController().signal
		);
		expect(result.transaction).toEqual({
			hash: 'abc',
			ledgerSequence: 63490364
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe(
			'/v1/analytics/transactions/abc?view=typed&limit=20'
		);
	});
	it('passes the resolved ledger and independent relation cursors on subsequent pages', async () => {
		const fetchMock = jest
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('{}', { status: 200 }));
		globalThis.fetch = fetchMock;
		await requestExplorerTransaction(
			'a/b',
			'63490364',
			{ operations: 'op', events: 'ev' },
			new AbortController().signal
		);
		expect(fetchMock.mock.calls[0][0]).toBe(
			'/v1/analytics/transactions/a%2Fb?view=typed&limit=20&ledger_sequence=63490364&operations_after=op&events_after=ev'
		);
	});
	it('preserves API failures instead of returning a legacy summary as parsed data', async () => {
		globalThis.fetch = jest
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ error: 'Not published' }), {
					status: 404
				})
			);
		await expect(
			requestExplorerTransaction('abc', '', {}, new AbortController().signal)
		).rejects.toThrow('HTTP 404: Not published');
	});
});
