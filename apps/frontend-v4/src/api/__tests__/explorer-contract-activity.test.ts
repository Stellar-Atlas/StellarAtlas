import { jest } from '@jest/globals';
import {
	contractActivityPath,
	parseContractActivityPage,
	requestContractActivity
} from '../explorer-contract-activity';
import {
	contractId,
	eventResponse
} from '../../components/blockchain/__tests__/contract-activity-fixtures';

describe('typed contract activity API contract', () => {
	afterEach(() => jest.restoreAllMocks());
	it('uses typed event cursors and omits empty or unrelated filters', () => {
		const url = new URL(
			contractActivityPath(
				contractId,
				'events',
				{
					min_ledger: '63490364',
					max_ledger: '63490365',
					start_time: '',
					source_account: 'ignored'
				},
				'opaque+/='
			),
			'https://example.test'
		);
		expect(url.pathname).toBe(
			'/v1/analytics/contracts/' + contractId + '/events'
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			limit: '10',
			min_ledger: '63490364',
			max_ledger: '63490365',
			view: 'typed',
			after: 'opaque+/='
		});
	});
	it('preserves the separate offset-based state endpoint', () => {
		const url = new URL(
			contractActivityPath(contractId, 'state', { min_ledger: '20' }, '10'),
			'https://example.test'
		);
		expect(url.searchParams.get('offset')).toBe('10');
		expect(url.searchParams.has('view')).toBe(false);
		expect(url.searchParams.has('after')).toBe(false);
		expect(
			parseContractActivityPage(
				{ rows: [{ key: 'a' }], nextOffset: 20 },
				contractId,
				'state',
				'10'
			).nextPosition
		).toBe('20');
	});
	it('accepts typed items and preserves coverage, provenance, and numeric JSON tokens', () => {
		const page = parseContractActivityPage(
			eventResponse('cursor-two'),
			contractId,
			'events'
		);
		expect(page.rows).toEqual(eventResponse().items);
		expect(page.nextPosition).toBe('cursor-two');
		expect(page.coverage.gapCount).toBe(1);
		expect(page.watermark.coverage).toBe('ingested-only');
		expect(page.rows[0]?.dataJson).toContain(
			'170141183460469231731687303715884105727'
		);
	});
	it('preserves a decoded void return alongside other events and its next cursor', () => {
		const response = eventResponse('next-page');
		const value = {
			...response,
			items: [
				response.items[0],
				{ ...response.items[0], id: 'return-event', dataJson: 'void' }
			]
		};
		const page = parseContractActivityPage(value, contractId, 'events');
		expect(page.rows).toHaveLength(2);
		expect(page.rows[1]?.dataJson).toBe('void');
		expect(page.nextPosition).toBe('next-page');
	});
	it.each([
		{ rows: [] },
		{ ...eventResponse(), contractId: 'wrong' },
		{ ...eventResponse(), nextCursor: 25 },
		{ ...eventResponse(), nextCursor: 'same' },
		{ ...eventResponse(), watermark: { minimumLedger: 12, maximumLedger: 11 } },
		{
			...eventResponse(),
			items: [{ ...eventResponse().items[0], dataJson: '{broken' }]
		}
	])(
		'rejects malformed responses instead of replacing the last good page',
		(value) => {
			expect(() =>
				parseContractActivityPage(value, contractId, 'events', 'same')
			).toThrow();
		}
	);
	it('uses one cancellable credential-free request and exposes HTTP failure for retry', async () => {
		const signal = new AbortController().signal;
		const fetcher = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(
				new Response(JSON.stringify(eventResponse()), { status: 200 })
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: 'Narrow the range or retry' }), {
					status: 503
				})
			);
		const path = contractActivityPath(contractId, 'events', {});
		await expect(
			requestContractActivity(path, contractId, 'events', '', signal)
		).resolves.toMatchObject({ nextPosition: null });
		expect(fetcher).toHaveBeenLastCalledWith(path, {
			headers: { accept: 'application/json' },
			credentials: 'omit',
			signal
		});
		await expect(
			requestContractActivity(path, contractId, 'events', '', signal)
		).rejects.toThrow('HTTP 503: Narrow the range or retry');
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
