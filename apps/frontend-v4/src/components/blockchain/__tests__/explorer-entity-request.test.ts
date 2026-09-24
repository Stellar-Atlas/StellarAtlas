import { jest } from '@jest/globals';
import {
	ExplorerEntityRequest,
	explorerPageHref,
	previousExplorerOffset
} from '../explorer-entity-request';
import {
	explorerRouteFilters,
	explorerRouteOffset
} from '../../../api/explorer-search-route';

const page = (offset = 0) => ({
	rows: [{ id: 'one' }],
	offset,
	limit: 25,
	nextOffset: offset + 25,
	window: { minLedger: 100, maxLedger: 200 },
	coverageStatus: 'complete'
});
const request = {
	filters: { seller: 'GA', min_ledger: '100', max_ledger: '200' },
	offset: 0,
	direction: 'reset' as const
};

describe('explorer entity request lifecycle', () => {
	it('retries the exact failed filters and page rather than the last successful query', async () => {
		const paths: string[] = [];
		let unavailable = false;
		const session = new ExplorerEntityRequest(
			'trades',
			undefined,
			async (path) => {
				paths.push(path);
				if (unavailable) throw new Error('HTTP 503: Temporarily unavailable');
				return page(
					Number(
						new URL(path, 'https://example.invalid').searchParams.get('offset')
					)
				);
			}
		);
		expect((await session.run(request))?.ok).toBe(true);
		unavailable = true;
		expect(
			await session.run({
				filters: { ...request.filters, seller: 'GB' },
				offset: 25,
				direction: 'next'
			})
		).toMatchObject({
			ok: false,
			message: 'HTTP 503: Temporarily unavailable'
		});
		expect(session.retryRequest).toMatchObject({
			filters: { seller: 'GB' },
			offset: 25,
			direction: 'next'
		});
		unavailable = false;
		const recovered = await session.run(session.retryRequest!);
		expect(recovered).toMatchObject({
			ok: true,
			page: { offset: 25 },
			request: { filters: { seller: 'GB' }, direction: 'next' }
		});
		expect(paths[2]).toBe(paths[1]);
		expect(paths[2]).toContain('offset=25');
	});
	it('captures attempted filters independently of later form edits', async () => {
		const filters = { source_account: 'GA' };
		const session = new ExplorerEntityRequest(
			'operations',
			undefined,
			async () => {
				throw new Error('Unavailable');
			}
		);
		await session.run({ ...request, filters });
		filters.source_account = 'GB';
		expect(session.retryRequest?.filters.source_account).toBe('GA');
	});
	it('normalizes local-time filters on the actual request and retains validation errors for retry', async () => {
		const paths: string[] = [];
		const session = new ExplorerEntityRequest(
			'operations',
			undefined,
			async (path) => {
				paths.push(path);
				return page();
			}
		);
		await session.run({
			...request,
			filters: { start_time: '2026-09-05T18:00:00-04:00' }
		});
		expect(
			new URL(paths[0]!, 'https://example.invalid').searchParams.get(
				'start_time'
			)
		).toBe('2026-09-05T22:00:00.000Z');
		expect(
			await session.run({ ...request, filters: { start_time: 'bad' } })
		).toMatchObject({ ok: false });
		expect(paths).toHaveLength(1);
		expect(session.retryRequest?.filters.start_time).toBe('bad');
	});
	it('ignores stale late responses and cancels unmounted requests', async () => {
		let resolveOld!: (value: unknown) => void;
		const signals: AbortSignal[] = [];
		const session = new ExplorerEntityRequest(
			'operations',
			undefined,
			(_path, signal) => {
				signals.push(signal);
				return signals.length === 1
					? new Promise((resolve) => {
							resolveOld = resolve;
						})
					: Promise.resolve(page(25));
			}
		);
		const old = session.run(request);
		const newest = await session.run({ ...request, offset: 25 });
		expect(signals[0]?.aborted).toBe(true);
		expect(newest).toMatchObject({ ok: true, page: { offset: 25 } });
		resolveOld(page());
		await expect(old).resolves.toBeNull();
		const pending = session.run(request);
		session.cancel();
		await expect(pending).resolves.toBeNull();
	});
	it('bounds an unavailable request and keeps it retryable', async () => {
		jest.useFakeTimers();
		try {
			const session = new ExplorerEntityRequest(
				'assets',
				undefined,
				(_path, signal) =>
					new Promise((_resolve, reject) => {
						signal.addEventListener(
							'abort',
							() => reject(new Error('aborted')),
							{ once: true }
						);
					})
			);
			const pending = session.run(request);
			await jest.advanceTimersByTimeAsync(25000);
			await expect(pending).resolves.toMatchObject({
				ok: false,
				message: expect.stringContaining('timed out')
			});
			expect(session.retryRequest).toEqual(request);
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.useRealTimers();
		}
	});
});

describe('reloadable explorer pages', () => {
	it('round-trips the actual offset and pinned coverage window without treating offset as a filter', () => {
		const href = explorerPageHref('trades', undefined, request.filters, 50);
		const query = Object.fromEntries(
			new URL(href, 'https://example.invalid').searchParams
		);
		expect(explorerRouteOffset(query.offset)).toBe(50);
		expect(explorerRouteFilters(query)).toEqual(request.filters);
		expect(previousExplorerOffset(50, 25, [])).toBe(25);
		expect(previousExplorerOffset(50, 25, [0, 17])).toBe(17);
		expect(previousExplorerOffset(17, 25, [])).toBe(0);
		expect(
			explorerPageHref('assets', 'native', request.filters, 50)
		).not.toContain('offset');
	});
	it('rejects invalid offsets and accepts the same bounded range as the API', () => {
		expect(explorerRouteOffset(undefined)).toBe(0);
		expect(explorerRouteOffset('10000')).toBe(10000);
		for (const value of ['-1', '10001', '1.5', 'NaN', '1e2', ['0', '25']])
			expect(explorerRouteOffset(value)).toBeNull();
	});
});
