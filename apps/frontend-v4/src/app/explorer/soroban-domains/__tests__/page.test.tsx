import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import Page from '../page';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const expiresAt = 1_900_000_000;
const evidence = {
	name: 'mate.xlm',
	source: 'creit-soroban-domains-v2',
	network: 'mainnet',
	observedLedger: 55_321_000
};
const fetchMock = jest.fn<typeof fetch>();

async function render(name?: string | string[]) {
	return renderToStaticMarkup(
		await Page({ searchParams: Promise.resolve({ name }) })
	);
}

beforeEach(() => {
	jest.replaceProperty(process, 'env', {
		...process.env,
		STELLAR_ATLAS_PUBLIC_API_URL: 'https://atlas.invalid'
	});
	jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
	jest.spyOn(Date, 'now').mockReturnValue((expiresAt - 300) * 1000);
	fetchMock.mockReset();
});

afterEach(() => {
	jest.restoreAllMocks();
});

test.each([
	{ address: account, addressKind: 'account', path: 'accounts' },
	{ address: contract, addressKind: 'contract', path: 'contracts' }
])(
	'keeps the full $addressKind address visible at the corresponding Explorer path',
	async ({ address, addressKind, path }) => {
		fetchMock.mockResolvedValueOnce(
			Response.json({
				...evidence,
				status: 'resolved',
				record: { address, addressKind, expiresAt }
			})
		);
		const html = await render('MATE.XLM');
		expect(html).toContain('action="/explorer/soroban-domains"');
		expect(html).toContain('href="/explorer/' + path + '/' + address + '"');
		expect(html).toContain('>' + address + '</a>');
		expect(html).toContain('mainnet ledger 55,321,000');
		expect(fetchMock).toHaveBeenCalledWith(
			'https://atlas.invalid/v1/soroban-domains/mate.xlm',
			expect.objectContaining({ cache: 'no-store' })
		);
	}
);

test.each([
	{ status: 'not_found', message: 'No registry record' },
	{ status: 'expired', message: 'expired or is stale' }
])('shows $status without an address', async ({ status, message }) => {
	fetchMock.mockResolvedValueOnce(Response.json({ ...evidence, status }));
	const html = await render('mate.xlm');
	expect(html).toContain(message);
	expect(html).not.toContain('href="/explorer/');
});

test('fails closed for a mismatched identity, wrong network, invalid checksum or upstream failure', async () => {
	const result = {
		...evidence,
		status: 'resolved',
		record: { address: account, addressKind: 'account', expiresAt }
	};
	for (const reply of [
		Response.json({ ...result, name: 'other.xlm' }),
		Response.json({ ...result, network: 'testnet' }),
		Response.json({
			...result,
			record: { ...result.record, address: 'G' + 'A'.repeat(55) }
		}),
		new Response(null, { status: 503 })
	]) {
		fetchMock.mockResolvedValueOnce(reply);
		const html = await render('mate.xlm');
		expect(html).toContain('Registry lookup is currently unavailable');
		expect(html).not.toContain('href="/explorer/');
	}
});

test('does not link a record that expires before rendering', async () => {
	jest.mocked(Date.now).mockReturnValue(expiresAt * 1000);
	fetchMock.mockResolvedValueOnce(
		Response.json({
			...evidence,
			status: 'resolved',
			record: { address: account, addressKind: 'account', expiresAt }
		})
	);
	const html = await render('mate.xlm');
	expect(html).toContain('expired or is stale');
	expect(html).not.toContain('href="/explorer/');
});

test('only looks up one valid submitted .xlm name', async () => {
	expect(await render()).toContain('Look up name');
	expect(await render('https://mate.xlm')).toContain('Enter a .xlm name');
	expect(await render(['mate.xlm', 'other.xlm'])).toContain(
		'Enter a .xlm name'
	);
	expect(fetchMock).not.toHaveBeenCalled();
});
