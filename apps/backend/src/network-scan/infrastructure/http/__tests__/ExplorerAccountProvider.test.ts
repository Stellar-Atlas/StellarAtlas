import request from 'supertest';
import { buildTestApp, canonicalSourceAccount } from './BlockchainExplorerRouterTestFixture.js';
import { fetchExplorerClaimablePage, type ClaimablePageQuery, type PositionPage } from '../ExplorerClaimablePage.js';
import { jest } from '@jest/globals';
import { fetchExplorerAccount, type ExplorerAccountDTO } from '../ExplorerAccountClient.js';
import { createExplorerAccountProvider } from '../ExplorerAccountProvider.js';
import { HorizonAccountReadError } from '../HorizonAccountResponse.js';

const config = { url: 'https://provider.example.org/', hostname: 'provider.example.org' };
const account: ExplorerAccountDTO = { accountId: 'G', balances: [], sequence: '1', source: 'horizon', subentryCount: 0, lastModifiedLedger: null };
const signal = () => new AbortController().signal;
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

it('shares matching readers and retains an attributed short-lived result, not a second provider', async () => {
	let now = 1_000_000;
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValueOnce(pending.promise).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	const first = service.read('G', signal()), second = service.read('G', signal());
	await Promise.resolve();
	expect(fetchAccount).toHaveBeenCalledTimes(1);
	pending.resolve(account);
	const [a, b] = await Promise.all([first, second]);
	expect(a).toBe(b);
	expect(a?.provider).toEqual({ mode: 'operator_alternate', hostname: config.hostname, observedAt: new Date(now).toISOString() });
	expect(await service.read('G', signal())).toBe(a);
	expect(fetchAccount.mock.calls[0]?.[0]).toBe(config.url);
	now += 20_001;
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
});

it('rejects excess distinct work and callers without creating a waiting-work queue', async () => {
	let now = 1_000_000;
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValue(pending.promise);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	const active = [service.read('0', signal())];
	await expect(service.read('too-soon', signal())).rejects.toMatchObject({ status: 429, retryAfterSeconds: 5 });
	now += 4_999;
	await expect(service.read('still-too-soon', signal())).rejects.toMatchObject({ status: 429, retryAfterSeconds: 1 });
	for (let index = 1; index < 4; index++) {
		now += index === 1 ? 1 : 5_000;
		active.push(service.read(String(index), signal()));
	}
	now += 5_000;
	await expect(service.read('excess', signal())).rejects.toMatchObject({ status: 429 });
	const joined = Array.from({ length: 60 }, () => service.read('0', signal()));
	await expect(service.read('0', signal())).rejects.toMatchObject({ status: 429 });
	await Promise.resolve();
	expect(fetchAccount).toHaveBeenCalledTimes(4);
	pending.resolve(account);
	await Promise.all([...active, ...joined]);
	await service.read('admitted-after-active', signal());
	await expect(service.read('rate-limited', signal())).rejects.toMatchObject({ status: 429 });
});

it('does not cancel other waiters or overlap a replacement while the last waiter is cancelling', async () => {
	let now = 1_000_000;
	const pending = deferred<ExplorerAccountDTO | null>();
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockReturnValueOnce(pending.promise).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	const a = new AbortController(), b = new AbortController();
	const first = service.read('G', a.signal), second = service.read('G', b.signal);
	await Promise.resolve();
	const upstream = fetchAccount.mock.calls[0]?.[2]?.signal;
	a.abort(new Error('First left'));
	await expect(first).rejects.toThrow('First left');
	expect(upstream?.aborted).toBe(false);
	b.abort(new Error('Last left'));
	await expect(second).rejects.toThrow('Last left');
	expect(upstream?.aborted).toBe(true);
	now += 5_000;
	await expect(service.read('G', signal())).rejects.toMatchObject({ status: 429 });
	pending.resolve(account);
	// Allow the cancelled upstream's complete then/catch/finally chain to settle.
	await new Promise(resolve => setImmediate(resolve));
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
});

it('honors bounded Retry-After and never automatically retries or selects the native endpoint', async () => {
	let now = 1_000_000;
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockRejectedValueOnce(new HorizonAccountReadError(120)).mockResolvedValue(account);
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	await expect(service.read('G', signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 120 });
	await expect(service.read('other', signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 120 });
	expect(fetchAccount).toHaveBeenCalledTimes(1);
	now += 120_001;
	await service.read('G', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(2);
	expect(fetchAccount.mock.calls.every(call => call[0] === config.url)).toBe(true);
});

it('expires retained values, refuses oversized values and briefly reuses not-found results', async () => {
	let now = 1_000_000;
	// Synthetic mapped DTO exercises the cache's byte accounting, not account validation.
	const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue({ ...account, sequence: '1'.repeat(1_800_000) });
	const service = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount });
	for (let index = 0; index < 5; index++) {
		now += 5_001;
		await service.read(String(index), signal());
	}
	await service.read('4', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(5);
	now += 5_001;
	await service.read('0', signal());
	expect(fetchAccount).toHaveBeenCalledTimes(6);
	const absent = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue(null);
	const missing = createExplorerAccountProvider(config, 'network', { now: () => now, fetchAccount: absent });
	expect(await missing.read('G', signal())).toBeNull();
	expect(await missing.read('G', signal())).toBeNull();
	expect(absent).toHaveBeenCalledTimes(1);
	now += 5_001;
	await missing.read('G', signal());
	expect(absent).toHaveBeenCalledTimes(2);
	const huge = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue({ ...account, sequence: '1'.repeat(2 * 1024 * 1024) });
	await expect(createExplorerAccountProvider(config, 'network', { fetchAccount: huge }).read('G', signal())).rejects.toMatchObject({ status: 503 });
});

const claimQuery: ClaimablePageQuery = { accountId: canonicalSourceAccount, role: 'claimant', limit: 1, after: null };
const claimPage: PositionPage = { source: 'horizon', transmission: 'native', accountId: canonicalSourceAccount,
 networkPassphrase: 'Test SDF Network ; September 2015', role: 'claimant', latestLedger: '100', snapshotStatus: 'ledger_bound',
 observation: { observedAt: '2026-11-08T00:00:00.000Z', networkStatus: 'unconfirmed', freshness: 'unknown', latestLedgerClosedAt: null },
 pageStatus: 'available', positions: [], nextCursor: null };

it('shares claimable starts and matching waiters with the account budget, while isolating page selectors', async () => {
 let now = 1_000_000;
 const pending = deferred<PositionPage>();
 const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue(account);
 const fetchClaimablePage = jest.fn<typeof fetchExplorerClaimablePage>().mockReturnValueOnce(pending.promise).mockResolvedValue(claimPage);
 const service = createExplorerAccountProvider(config, claimPage.networkPassphrase, { now: () => now, fetchAccount, fetchClaimablePage });
 const a = service.readClaimablePage(claimQuery, signal()), b = service.readClaimablePage({ ...claimQuery }, signal());
 await expect(service.read(claimQuery.accountId, signal())).rejects.toMatchObject({ status: 429 });
 pending.resolve(claimPage);
 const [first, second] = await Promise.all([a,b]);
 expect(first).toBe(second);
 expect(first).toMatchObject({ provider: { ...service.provider, observedAt: new Date(now).toISOString() }, transmission: 'operator_alternate', observation: { freshness: 'unknown', networkStatus: 'unconfirmed' } });
 expect(await service.readClaimablePage(claimQuery, signal())).toBe(first);
 for (const query of [{ ...claimQuery, role: 'sponsor' as const }, { ...claimQuery, limit: 2 },
  { ...claimQuery, after: '99-00000000' + 'a'.repeat(64) }, { ...claimQuery, accountId: 'other' }]) {
  await expect(service.readClaimablePage(query, signal())).rejects.toMatchObject({ status: 429 });
  now += 5_000;
  await service.readClaimablePage(query, signal());
 }
 expect(fetchClaimablePage).toHaveBeenCalledTimes(5);
 expect(fetchAccount).not.toHaveBeenCalled();
 now += 5_000;
 await service.read(claimQuery.accountId, signal());
 expect(fetchAccount).toHaveBeenCalledTimes(1);
 expect(fetchClaimablePage.mock.calls.every(call => call[0] === config.url)).toBe(true);
});

it('shares claimable failures and Retry-After cooldown with account reads without native fallback', async () => {
 let now = 1_000_000;
 const fetchAccount = jest.fn<typeof fetchExplorerAccount>().mockResolvedValue(account);
 const fetchClaimablePage = jest.fn<typeof fetchExplorerClaimablePage>().mockRejectedValueOnce(new HorizonAccountReadError(120));
 const service = createExplorerAccountProvider(config, claimPage.networkPassphrase, { now: () => now, fetchAccount, fetchClaimablePage });
 await expect(service.readClaimablePage(claimQuery, signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 120 });
 now += 5_000;
 await expect(service.read('other', signal())).rejects.toMatchObject({ status: 503, retryAfterSeconds: 115 });
 expect(fetchAccount).not.toHaveBeenCalled();
 expect(fetchClaimablePage).toHaveBeenCalledTimes(1);
 now += 115_001;
 await service.read('other', signal());
});

it('cancels claimable upstream only after the last matching waiter leaves and does not cache the abandoned page', async () => {
 let now = 1_000_000;
 const pending = deferred<PositionPage>();
 const fetchClaimablePage = jest.fn<typeof fetchExplorerClaimablePage>().mockReturnValueOnce(pending.promise).mockResolvedValue(claimPage);
 const service = createExplorerAccountProvider(config, claimPage.networkPassphrase, { now: () => now, fetchClaimablePage });
 const a = new AbortController(), b = new AbortController();
 const first = service.readClaimablePage(claimQuery, a.signal), second = service.readClaimablePage(claimQuery, b.signal);
 await Promise.resolve();
 const upstream = fetchClaimablePage.mock.calls[0]?.[2].signal;
 a.abort(new Error('first left'));
 await expect(first).rejects.toThrow('first left');
 expect(upstream?.aborted).toBe(false);
 b.abort(new Error('last left'));
 await expect(second).rejects.toThrow('last left');
 expect(upstream?.aborted).toBe(true);
 pending.resolve(claimPage);
 await new Promise(resolve => setImmediate(resolve));
 now += 5_000;
 await service.readClaimablePage(claimQuery, signal());
 expect(fetchClaimablePage).toHaveBeenCalledTimes(2);
});

it('routes a bounded claimant/cursor and sponsor page through the one configured alternate with attributed throttling', async () => {
 let now = 1_000_000;
 const id = '00000000' + 'a'.repeat(64);
 const row = { id, paging_token: '99-' + id, last_modified_ledger: 99, last_modified_time: '2026-11-08T00:00:00Z',
  asset: 'native', amount: '922337203685.4775807', sponsor: canonicalSourceAccount,
  claimants: [{ destination: canonicalSourceAccount, predicate: { not: { rel_before: '300' } } }] };
 const fetch = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ _embedded: { records: [row] } }, { headers: { 'latest-ledger': '100' } }));
 try {
  const service = createExplorerAccountProvider(config, claimPage.networkPassphrase, { now: () => now });
  const app = buildTestApp({ accountProviderService: service });
  const route = '/v1/explorer/accounts/' + canonicalSourceAccount + '/claimable-positions';
  const first = await request(app).get(route).query({ role: 'claimant', limit: 1 }).expect(200);
  expect(first.body).toMatchObject({ transmission: 'operator_alternate', provider: service.provider,
   observation: { networkStatus: 'unconfirmed', freshness: 'unknown', latestLedgerClosedAt: null },
   positions: [{ amountRaw: '9223372036854775807', roles: ['claimant','sponsor'], claimants: [{ predicate: { type: 'not', predicate: { type: 'before_relative_time', seconds: '300' } } }] }] });
  const limited = await request(app).get(route).query({ role: 'sponsor', limit: 1 }).expect(429).expect('Retry-After', '5');
  expect(limited.body.provider).toEqual(service.provider);
  await request(app).get(route).query({ role: 'sponsor', cursor: first.body.nextCursor }).expect(400);
  now += 5_000;
  // Next page must use a lower record. HAL links are never followed.
  fetch.mockResolvedValueOnce(Response.json({ _embedded: { records: [] } }, { headers: { 'latest-ledger': '101' } }));
  await request(app).get(route).query({ role: 'claimant', limit: 1, cursor: first.body.nextCursor }).expect(200);
  expect(String(fetch.mock.calls[1]?.[0])).toContain('cursor=99-' + id);
  now += 5_000;
  await request(app).get(route).query({ role: 'sponsor', limit: 1 }).expect(200);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.every(call => new URL(String(call[0])).origin === 'https://provider.example.org')).toBe(true);
  expect(String(fetch.mock.calls[2]?.[0])).toContain('sponsor=' + canonicalSourceAccount);
  now += 5_000;
  fetch.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '120' } }));
  await request(app).get(route).query({ role: 'sponsor', limit: 2 }).expect(503).expect('Retry-After', '120');
  await request(app).get('/v1/explorer/accounts/' + canonicalSourceAccount).expect(503);
  expect(fetch).toHaveBeenCalledTimes(4);
 } finally { fetch.mockRestore(); }
});
