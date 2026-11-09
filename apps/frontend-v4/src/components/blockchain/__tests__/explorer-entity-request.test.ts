import { jest } from '@jest/globals';
import {
	ExplorerEntityRequest,
	explorerPageHref,
	explorerSelectionKey,
	readExplorerPageSelection,
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
const contract = 'CBQSUF57OYX4RIMCZV62DKN6JFOTEKPHIZASMJYOUOCNHGNG2P3XQLSE';
const windowMiss = {
	entity: 'contracts', source: 'stellar_hubble', record: null,
	window: { minLedger: 100, maxLedger: 200 },
	error: 'Record was not found in the selected parsed window'
};

describe('explorer entity request lifecycle', () => {
	it.each([
		[404, 'hubble_record_not_found', 'complete'],
		[409, 'hubble_range_not_fully_ingested', 'partial_or_unknown']
	] as const)('preserves the returned contract activity window for HTTP %i', async (status, code, coverageStatus) => {
		const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
			Response.json({ ...windowMiss, code, coverageStatus }, { status })
		);
		try {
			const session = new ExplorerEntityRequest('contracts', contract);
			await expect(session.run({ ...request, filters: { limit: '10' } })).resolves.toMatchObject({
				ok: false, windowMiss: { ...windowMiss.window, coverage: coverageStatus }
			});
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(fetch.mock.calls[0]?.[0]).toBe('/v1/contracts/' + contract + '?limit=10&offset=0');
		} finally { fetch.mockRestore(); }
	});
	it('does not reinterpret generic 404, upstream 503 or transport errors as scoped contract misses', async () => {
		const fetch = jest.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(Response.json({ error: 'Not found' }, { status: 404 }))
			.mockResolvedValueOnce(Response.json({ ...windowMiss, code: 'hubble_record_not_found', coverageStatus: 'complete' }, { status: 503 }))
			.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		try {
			const session = new ExplorerEntityRequest('contracts', contract);
			const selection = { ...request, filters: { min_ledger: '100', max_ledger: '200' } };
			for (const message of ['HTTP 404: Not found', 'HTTP 503: ' + windowMiss.error, 'Failed to fetch']) {
				await expect(session.run(selection)).resolves.toEqual({ ok: false, message });
			}
			expect(session.retryRequest).toEqual(selection);
		} finally { fetch.mockRestore(); }
	});
	it('restores bounded URL selection without treating return context as API filters or revisiting a pinned accepted query', () => {
		const restored = readExplorerPageSelection('seller=GA&min_ledger=100&max_ledger=200&limit=10&offset=20&return_to=%2Fexplorer', {}, 0, false);
		expect(restored).toEqual({ filters: { seller: 'GA', min_ledger: '100', max_ledger: '200', limit: '10' }, offset: 20 });
		expect(explorerSelectionKey(restored.filters, 20)).toBe(explorerSelectionKey({ limit: '10', max_ledger: '200', min_ledger: '100', seller: 'GA' }, 20));
		expect(readExplorerPageSelection('offset=20', {}, 0, true).offset).toBe(0);
		expect(readExplorerPageSelection('seller=GA&seller=GB&offset=10001', {}, 0, false)).toEqual({ filters: {}, offset: 0 });
	});
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
	it('keeps a slow request running until explicitly cancelled', async () => {
		jest.useFakeTimers();
		try {
			const signals: AbortSignal[] = [];
			const session = new ExplorerEntityRequest(
				'assets',
				undefined,
				(_path, signal) => {
					signals.push(signal);
					return new Promise((_resolve, reject) => {
						signal.addEventListener(
							'abort',
							() => reject(new Error('aborted')),
							{ once: true }
						);
					});
				}
			);
			const pending = session.run(request);
			await jest.advanceTimersByTimeAsync(30000);
			expect(signals[0]?.aborted).toBe(false);
			let settled = false;
			void pending.then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(settled).toBe(false);
			expect(session.retryRequest).toEqual(request);
			session.cancel();
			await expect(pending).resolves.toBeNull();
			expect(jest.getTimerCount()).toBe(0);
		} finally {
			jest.useRealTimers();
		}
	});
	it('invalidates pending Back A when restoring already accepted B without another network request', async () => {
		let finish!: (value: unknown) => void;
		let calls = 0;
		const session = new ExplorerEntityRequest('offers', undefined, () => ++calls === 1 ? Promise.resolve(page(25)) : new Promise((resolve) => { finish = resolve; }));
		expect(await session.run({...request, offset:25})).toMatchObject({ok:true, page:{offset:25}});
		const backA = session.run(request);
		session.cancel(); // URL returned to accepted B: restore B rather than fetch it again.
		finish(page(0));
		await expect(backA).resolves.toBeNull();
		expect(calls).toBe(2);
	});
});

describe('reloadable explorer pages', () => {
	it('retains safe investigation context when list results pin their loaded window', () => {
		const url = new URL(explorerPageHref('operations', undefined, request.filters, 0, '/explorer/ledgers/100?ledger_view=transactions'), 'https://example.invalid');
		expect(url.searchParams.get('return_to')).toBe('/explorer/ledgers/100?ledger_view=transactions');
		expect(explorerPageHref('operations', undefined, request.filters, 0, 'https://outside.invalid')).not.toContain('return_to');
	});
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
