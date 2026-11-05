import { afterEach, beforeEach, expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExplorerAccountFederation } from '../explorer-account-federation';
import { startAccountFederationLookup } from '../explorer-account-federation-request';
import type { FederationResult } from '../explorer-account-federation-request';

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const other = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC6PV';
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const display = {
	accountId: account,
	network: 'mainnet',
	status: 'display_only',
	stellarAddress: 'CaseSensitive*EXAMPLE.org',
	memo: { type: 'id', value: '18446744073709551615' },
	homeDomain: 'home.example',
	aliasDomain: 'example.org',
	reverseProviderOrigin: 'https://reverse.example',
	forwardProviderOrigin: 'https://forward.example',
	observedLedger: '55223344'
} as const;
const now = Date.parse('2026-11-05T21:50:00Z');

function response(
	body: unknown,
	status = 200,
	headers?: HeadersInit
): Response {
	return Response.json(body, { status, headers });
}

function mount(
	accountId = account,
	network: 'mainnet' | 'testnet' = 'mainnet'
) {
	const report = jest.fn<(value: FederationResult) => void>();
	const stop = startAccountFederationLookup(accountId, network, report);
	return { report, stop };
}

async function flush(): Promise<void> {
	await jest.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
	jest.useFakeTimers({ now, doNotFake: ['queueMicrotask'] });
});

afterEach(() => {
	jest.clearAllTimers();
	jest.useRealTimers();
	jest.restoreAllMocks();
});

it('renders an accessible loading state only for an active classic account', () => {
	const render = (accountId: string, active: boolean) =>
		renderToStaticMarkup(
			<ExplorerAccountFederation
				accountId={accountId}
				network="mainnet"
				active={active}
			/>
		);
	expect(render(account, true)).toMatch(
		/<section.*aria-labelledby=.*<h2.*Federation name.*role="status".*Checking federation name/
	);
	expect(render(account, false)).toBe('');
	expect(render(contract, true)).toBe('');
	expect(render(account.slice(0, -1) + 'A', true)).toBe('');
});

it('skips the Strict Mode probe and makes one fixed no-store GET for the active view', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(response(display));
	const probe = mount();
	probe.stop();
	const active = mount();
	await flush();
	expect(fetch).toHaveBeenCalledTimes(1);
	expect(fetch).toHaveBeenCalledWith(
		'/v1/explorer/accounts/' + account + '/federation',
		{
			signal: expect.any(AbortSignal),
			cache: 'no-store',
			credentials: 'omit',
			redirect: 'error',
			headers: { accept: 'application/json' }
		}
	);
	const { accountId, network, ...evidence } = display;
	expect(active.report).toHaveBeenCalledWith(evidence);
	expect(probe.report).not.toHaveBeenCalled();
	await jest.advanceTimersByTimeAsync(60_000);
	expect(fetch).toHaveBeenCalledTimes(1);
	active.stop();
});

it('discards even a late successful response after account navigation or view exit', async () => {
	let resolveOld!: (value: Response) => void;
	const old = new Promise<Response>((resolve) => {
		resolveOld = resolve;
	});
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockReturnValueOnce(old)
		.mockResolvedValueOnce(
			response({
				...display,
				accountId: other,
				stellarAddress: 'Other*example.org'
			})
		);
	const previous = mount();
	await flush();
	previous.stop();
	expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

	const current = mount(other);
	await flush();
	resolveOld(response(display));
	await flush();
	expect(previous.report).not.toHaveBeenCalled();
	expect(current.report).toHaveBeenCalledTimes(1);
	expect(current.report).toHaveBeenCalledWith(
		expect.objectContaining({ stellarAddress: 'Other*example.org' })
	);
	expect(fetch.mock.calls[1]?.[0]).toBe(
		'/v1/explorer/accounts/' + other + '/federation'
	);
	current.stop();
});

it('bounds a stuck lookup and reports unavailable without retrying', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockReturnValue(new Promise(() => {}));
	const active = mount();
	await flush();
	await jest.advanceTimersByTimeAsync(11_999);
	expect(active.report).not.toHaveBeenCalled();
	await jest.advanceTimersByTimeAsync(1);
	expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
	expect(active.report).toHaveBeenCalledWith({ status: 'unavailable' });
	await jest.advanceTimersByTimeAsync(60_000);
	expect(fetch).toHaveBeenCalledTimes(1);
	active.stop();
});

it.each([
	'indexed_evidence_insufficient',
	'unsupported',
	'not_found',
	'mismatch',
	'malformed'
] as const)(
	'preserves %s without inventing an alias or retrying',
	async (status) => {
		const fetch = jest
			.spyOn(globalThis, 'fetch')
			.mockResolvedValue(
				response({ accountId: account, network: 'mainnet', status })
			);
		const active = mount();
		await flush();
		expect(active.report).toHaveBeenCalledWith({ status });
		await jest.advanceTimersByTimeAsync(60_000);
		expect(fetch).toHaveBeenCalledTimes(1);
		active.stop();
	}
);

it.each([
	['wrong account', { ...display, accountId: other }, 200],
	['wrong network', { ...display, network: 'testnet' }, 200],
	['numeric memo', { ...display, memo: { type: 'id', value: 123 } }, 200],
	[
		'non-origin URL',
		{ ...display, forwardProviderOrigin: 'https://forward.example/path' },
		200
	],
	['503', { status: 'temporary_failure' }, 503],
	['404 route', { status: 'not_found' }, 404]
])('fails closed for %s', async (_name, body, status) => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(response(body, status));
	const active = mount();
	await flush();
	expect(active.report).toHaveBeenCalledWith({ status: 'unavailable' });
	expect(fetch).toHaveBeenCalledTimes(1);
	active.stop();
});

it.each([
	{ type: 'text', value: '  Exact  Text  ' },
	{ type: 'id', value: '00000000000000000001' },
	{ type: 'hash', value: 'A'.repeat(43) + '=' },
	null
])('preserves the exact memo %j and alias on testnet', async (memo) => {
	jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(response({ ...display, network: 'testnet', memo }));
	const active = mount(account, 'testnet');
	await flush();
	expect(active.report).toHaveBeenCalledWith(
		expect.objectContaining({ memo, stellarAddress: display.stellarAddress })
	);
	active.stop();
});

it('honors Retry-After on re-entry without polling and leaves the next view after expiry eligible', async () => {
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(response({}, 429, { 'Retry-After': '7' }))
		.mockResolvedValueOnce(response({ ...display, accountId: other }));
	const original = mount(other);
	await flush();
	expect(original.report).toHaveBeenCalledWith({
		status: 'throttled',
		retryAtMs: now + 7_000
	});
	original.stop();
	const earlyReentry = mount(other);
	await flush();
	expect(earlyReentry.report).toHaveBeenCalledWith({
		status: 'throttled',
		retryAtMs: now + 7_000
	});
	await jest.advanceTimersByTimeAsync(7_000);
	expect(fetch).toHaveBeenCalledTimes(1);
	earlyReentry.stop();

	const afterExpiry = mount(other);
	await flush();
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(afterExpiry.report).toHaveBeenCalledWith(
		expect.objectContaining({ status: 'display_only' })
	);
	afterExpiry.stop();
});

it('uses a bound retry deadline from the body when the header is unavailable', async () => {
	const retryAtMs = now + 6_000;
	const fetch = jest
		.spyOn(globalThis, 'fetch')
		.mockResolvedValueOnce(
			response(
				{
					accountId: other,
					network: 'testnet',
					status: 'throttled',
					retryAtMs
				},
				429
			)
		)
		.mockResolvedValueOnce(response({ ...display, accountId: other }));
	const testnet = mount(other, 'testnet');
	await flush();
	expect(testnet.report).toHaveBeenCalledWith({
		status: 'throttled',
		retryAtMs
	});
	testnet.stop();
	const mainnet = mount(other, 'mainnet');
	await flush();
	expect(fetch).toHaveBeenCalledTimes(2);
	expect(mainnet.report).toHaveBeenCalledWith(
		expect.objectContaining({ status: 'display_only' })
	);
	mainnet.stop();
});
