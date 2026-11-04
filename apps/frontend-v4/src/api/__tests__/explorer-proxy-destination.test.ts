import { jest } from '@jest/globals';
import { GET as getBalances } from '../../app/api/explorer/account-balances/[account]/route';
import { GET as getTransaction } from '../../app/api/explorer/typed-transactions/[hash]/route';
import { proxyExplorerJson } from '../../app/api/explorer/bounded-json-proxy';

const hash = 'a'.repeat(64);
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const configured = 'https://api.internal.test:8443/gateway/';
const requestBase = 'https://attacker.invalid/';
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
const originalConfig = process.env.STELLAR_ATLAS_PUBLIC_API_URL;

beforeEach(() => {
	process.env.STELLAR_ATLAS_PUBLIC_API_URL = configured;
	globalThis.fetch = fetchMock.mockReset().mockImplementation(async () => Response.json({ ok: true }));
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	if (originalConfig === undefined) delete process.env.STELLAR_ATLAS_PUBLIC_API_URL;
	else process.env.STELLAR_ATLAS_PUBLIC_API_URL = originalConfig;
});

it('uses only the configured authority and server-owned routes for both GETs', async () => {
	const typed = 'view=typed&limit=20&ledger_sequence=42&events_after=next_page';
	const balance = 'limit=25&after=next_page';
	const request = (query: string) => new Request(requestBase + '?' + query, {
		headers: { host: 'spoof.invalid', 'x-forwarded-host': 'spoof.invalid' }
	});
	expect((await getTransaction(request(typed), { params: Promise.resolve({ hash }) })).status).toBe(200);
	expect((await getBalances(request(balance), { params: Promise.resolve({ account }) })).status).toBe(200);
	expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
		configured + 'v1/analytics/transactions/' + hash + '?' + typed,
		configured + 'v1/analytics/accounts/' + account + '/balances?' + balance
	]);
	for (const [, options] of fetchMock.mock.calls) expect(options).toMatchObject({
		headers: { accept: 'application/json' }, redirect: 'error'
	});
});

it('rejects destination and traversal attempts from both incoming routes', async () => {
	const typed = requestBase + '?view=typed&limit=20';
	const balance = requestBase + '?limit=25';
	for (const id of ['//169.254.169.254/latest', '..', '%2e%2e', 'a\\..\\admin']) {
		expect((await getTransaction(new Request(typed), { params: Promise.resolve({ hash: id }) })).status).toBe(400);
		expect((await getBalances(new Request(balance), { params: Promise.resolve({ account: id }) })).status).toBe(400);
	}
	for (const [route, query] of [
		['typed', typed + '&events_after=%2F%2Fevil.invalid%2F'],
		['balance', balance + '&after=a%26url%3Dhttps%3A%2F%2Fevil.invalid']
	] as const) {
		const incoming = new Request(query);
		const response = route === 'typed'
			? await getTransaction(incoming, { params: Promise.resolve({ hash }) })
			: await getBalances(incoming, { params: Promise.resolve({ account }) });
		expect(response.status).toBe(400);
	}
	expect(fetchMock).not.toHaveBeenCalled();
});

it('rejects a raw path at the helper and keeps delimiters inside individual query values', async () => {
	const request = new Request(requestBase);
	const query = new URLSearchParams([['after', 'a&url=https://evil.invalid/#']]);
	expect((await proxyExplorerJson(request, 'account balance', '../admin', query, 1024)).status).toBe(502);
	expect(fetchMock).not.toHaveBeenCalled();
	expect((await proxyExplorerJson(request, 'account balance', account, query, 1024)).status).toBe(200);
	const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
	expect(url.origin).toBe('https://api.internal.test:8443');
	expect(url.pathname).toBe('/gateway/v1/analytics/accounts/' + account + '/balances');
	expect([...url.searchParams]).toEqual([...query]);
	expect(url.hash).toBe('');
});

it.each(['file:///etc/passwd', 'https://user:pass@api.test', 'https://api.test/?url=evil', 'https://api.test/#fragment'])(
	'fails closed for an invalid server API base: %s',
	async (base) => {
		process.env.STELLAR_ATLAS_PUBLIC_API_URL = base;
		const result = await getTransaction(new Request(requestBase + '?view=typed&limit=20'), {
			params: Promise.resolve({ hash })
		});
		expect(result.status).toBe(502);
		expect(fetchMock).not.toHaveBeenCalled();
	}
);
