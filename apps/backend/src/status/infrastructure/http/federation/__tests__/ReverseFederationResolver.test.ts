import { Networks, StrKey } from '@stellar/stellar-sdk';
import {
	requestPublicHttps,
	type SafeResponse
} from '../../asset-metadata/safeHttp.js';
import {
	FederationThrottled,
	LocalFederationProviderBudget
} from '../FederationProviderBudget.js';
import { ReverseFederationResolver } from '../ReverseFederationResolver.js';

const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
const other = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
const alias = 'alice+help@example.net*alias.example';
const home = 'https://home.example/.well-known/stellar.toml';
const aliasToml = 'https://alias.example/.well-known/stellar.toml';
const reverseEndpoint =
	'https://provider.example/federation/private-reverse?tenant=a%20b&token=reverse-secret';
const forwardEndpoint =
	'https://forward.example/federation/private-forward?tenant=forward&token=forward-secret';
const memo = '18446744073709551615';
const response = (
	status: number,
	body = '',
	headers: Record<string, string> = {}
): SafeResponse => ({ status, headers, body: Buffer.from(body) });
const toml = (endpoint: string) =>
	response(200, 'FEDERATION_SERVER = ' + JSON.stringify(endpoint));
const record = (patch: object = {}) =>
	response(
		200,
		JSON.stringify({
			account_id: account,
			stellar_address: alias,
			memo_type: 'id',
			memo,
			...patch
		})
	);

function fixture(budget = new LocalFederationProviderBudget()) {
	const request = jest.fn<
		ReturnType<typeof requestPublicHttps>,
		Parameters<typeof requestPublicHttps>
	>();
	const resolver = new ReverseFederationResolver(budget, request);
	return { request, resolver };
}

it('discovers the exact cross-domain endpoints and pairs account and string memo', async () => {
	const { request, resolver } = fixture();
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(record())
		.mockResolvedValueOnce(toml(forwardEndpoint))
		.mockResolvedValueOnce(record());
	await expect(resolver.resolve(account, 'Home.Example.')).resolves.toEqual({
		status: 'display_only',
		accountId: account,
		stellarAddress: alias,
		memo: { type: 'id', value: memo },
		homeDomain: 'home.example',
		reverseProviderOrigin: 'https://provider.example',
		aliasDomain: 'alias.example',
		forwardProviderOrigin: 'https://forward.example'
	});
	expect(request.mock.calls.map(([url]) => url)).toEqual([
		home,
		reverseEndpoint + '&q=' + account + '&type=id',
		aliasToml,
		forwardEndpoint + '&q=' + encodeURIComponent(alias) + '&type=name'
	]);
	for (const [, headers, limit, options] of request.mock.calls) {
		expect(headers['cache-control']).toBe('no-store');
		expect(limit).toBeLessThanOrEqual(100_000);
		expect(options).toEqual({
			signal: expect.any(AbortSignal),
			followRedirects: false
		});
	}
	expect(request.mock.calls[0]?.[3]?.signal).toBe(
		request.mock.calls[3]?.[3]?.signal
	);
});

it('returns a generic failure when transport diagnostics contain an endpoint secret', async () => {
	const { request, resolver } = fixture();
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockRejectedValueOnce(new Error('Failed request to ' + reverseEndpoint));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'temporary_failure'
	});
});

it('blocks network-mismatched discovery and requires testnet to be explicitly advertised', async () => {
	const { request } = fixture();
	const budget = new LocalFederationProviderBudget();
	const testnet = new ReverseFederationResolver(
		budget,
		request,
		Networks.TESTNET
	);
	request.mockResolvedValueOnce(toml(reverseEndpoint));
	await expect(testnet.resolve(account, 'home.example')).resolves.toEqual({
		status: 'unsupported'
	});
	expect(request).toHaveBeenCalledTimes(1);
	request
		.mockResolvedValueOnce(
			response(
				200,
				'FEDERATION_SERVER = ' +
					JSON.stringify(reverseEndpoint) +
					'\nNETWORK_PASSPHRASE = ' +
					JSON.stringify(Networks.TESTNET)
			)
		)
		.mockResolvedValueOnce(record())
		.mockResolvedValueOnce(toml(forwardEndpoint));
	await expect(testnet.resolve(account, 'home.example')).resolves.toEqual({
		status: 'unsupported'
	});
	expect(request).toHaveBeenCalledTimes(4);
});

it.each([
	{ account_id: other },
	{ stellar_address: 'someone-else*alias.example' },
	{ stellar_address: 'alice+help@example.net*ALIAS.EXAMPLE' },
	{ memo: '2' },
	{ memo_type: undefined, memo: undefined },
	{ memo_type: 'text', memo }
])('rejects conflicting forward account, name or memo %#', async (patch) => {
	const { request, resolver } = fixture();
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(record())
		.mockResolvedValueOnce(toml(forwardEndpoint))
		.mockResolvedValueOnce(record(patch));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'mismatch'
	});
});

it.each([
	{ memo: 1 },
	{ memo: '18446744073709551616' },
	{ memo_type: 'hash', memo: 'bad' },
	{ stellar_address: 'two*stars*alias.example' },
	{ account_id: 'Gbad' }
])('rejects malformed provider records %#', async (patch) => {
	const { request, resolver } = fixture();
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(record(patch));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'malformed'
	});
	expect(request).toHaveBeenCalledTimes(2);
});

it.each([
	'http://provider.example/sep2',
	'https://127.0.0.1/sep2',
	'https://provider.example/sep2#fragment',
	'https://user@provider.example/sep2',
	'https://provider.example:8080/sep2',
	'https://provider.example/sep2?%71=override'
])('rejects unsafe or ambiguous advertisements %#', async (endpoint) => {
	const { request, resolver } = fixture();
	request.mockResolvedValueOnce(toml(endpoint));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'malformed'
	});
	expect(request).toHaveBeenCalledTimes(1);
});

it('keeps discovery unsupported, reverse not found and temporary transport errors separate', async () => {
	const { request, resolver } = fixture();
	await expect(resolver.resolve(account, null)).resolves.toEqual({
		status: 'unsupported'
	});
	request.mockResolvedValueOnce(response(200, 'VERSION = "2.0.0"'));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'unsupported'
	});
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(response(404));
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'not_found'
	});
	request.mockResolvedValueOnce(toml(reverseEndpoint)).mockResolvedValueOnce(
		response(302, '', {
			location: 'https://redirect.example/unsafe'
		})
	);
	await expect(resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'temporary_failure'
	});
	expect(request.mock.calls.map(([url]) => url)).not.toContain(
		'https://redirect.example/unsafe'
	);
});

it('deduplicates only the unresolved lookup and leaves no completed alias or memo cache', async () => {
	const { request, resolver } = fixture();
	const sameDomain = (name: string, memo: string) =>
		record({ stellar_address: name + '*home.example', memo });
	request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(sameDomain('old-name', '1'))
		.mockResolvedValueOnce(sameDomain('old-name', '1'))
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(sameDomain('new-name', '2'))
		.mockResolvedValueOnce(sameDomain('new-name', '2'));
	const first = resolver.resolve(account, 'home.example');
	expect(resolver.resolve(account, 'home.example')).toBe(first);
	await expect(first).resolves.toMatchObject({
		stellarAddress: 'old-name*home.example',
		memo: { value: '1' }
	});
	expect(request).toHaveBeenCalledTimes(3);
	await expect(
		resolver.resolve(account, 'home.example')
	).resolves.toMatchObject({
		stellarAddress: 'new-name*home.example',
		memo: { value: '2' }
	});
	expect(request).toHaveBeenCalledTimes(6);
});

it('shares provider Retry-After and local backoff across domains and resolver instances', async () => {
	let now = 10_000;
	const budget = new LocalFederationProviderBudget(() => now);
	const one = fixture(budget);
	const two = fixture(budget);
	one.request
		.mockResolvedValueOnce(toml(reverseEndpoint))
		.mockResolvedValueOnce(response(429, '', { 'retry-after': '90' }));
	two.request.mockResolvedValueOnce(
		toml(forwardEndpoint.replace('forward.example', 'provider.example'))
	);
	await expect(one.resolver.resolve(account, 'home.example')).resolves.toEqual({
		status: 'throttled',
		retryAtMs: 100_000
	});
	await expect(two.resolver.resolve(other, 'other.example')).resolves.toEqual({
		status: 'throttled',
		retryAtMs: 100_000
	});
	expect(two.request).toHaveBeenCalledTimes(1);
	now = 100_000;
	await budget.run('provider.example', async () =>
		response(503, '', { 'retry-after': new Date(now + 10_000).toUTCString() })
	);
	await expect(
		budget.run('provider.example', async () => response(200))
	).rejects.toMatchObject({ retryAtMs: 110_000 });
	now = 110_000;
	await budget.run('provider.example', async () => response(503));
	await expect(
		budget.run('provider.example', async () => response(200))
	).rejects.toMatchObject({ retryAtMs: 114_000 });
});

it('enforces concurrent and window budgets without queuing', async () => {
	const budget = new LocalFederationProviderBudget(() => 10);
	let complete!: (value: SafeResponse) => void;
	const responseGate = new Promise<SafeResponse>((resolve) => {
		complete = resolve;
	});
	const pending = [
		budget.run('provider.example', () => responseGate),
		budget.run('provider.example', () => responseGate)
	];
	const work = jest.fn(async () => response(200));
	await expect(budget.run('provider.example', work)).rejects.toBeInstanceOf(
		FederationThrottled
	);
	expect(work).not.toHaveBeenCalled();
	complete(response(200));
	await Promise.all(pending);
	for (let i = 0; i < 6; i++) await budget.run('provider.example', work);
	await expect(budget.run('provider.example', work)).rejects.toMatchObject({
		retryAtMs: 60_010
	});
	await expect(budget.run('another.example', work)).resolves.toMatchObject({
		status: 200
	});
});

it('refuses private targets and an expired overall deadline before issuing HTTPS', async () => {
	await expect(
		requestPublicHttps('https://127.0.0.1/', {}, 4096)
	).rejects.toThrow('non-public');
	await expect(
		requestPublicHttps('https://example.com/', {}, 4096, {
			signal: AbortSignal.abort()
		})
	).rejects.toThrow();
});
