import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { Writable } from 'node:stream';
import { renderToPipeableStream } from 'react-dom/server';
import { publicNetworkPassphrase } from '@api/explorer-current-account-snapshot';
import type { CatalogueSearchParams } from '@api/verified-contract-catalogue';

jest.unstable_mockModule('@components/blockchain/explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('@components/blockchain/explorer-verified-contracts.module.css', () => ({ default: {} }));
const { default: Page } = await import('../page');
const fetchMock = jest.fn<typeof fetch>();
const first = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const second = 'CB23WRDQWGSP6YPMY4UV5C4OW5CBTXKYN3XEATG7KJEZCXMJBYEHOUOV';
const commit = 'a'.repeat(40);
const digest = 'b'.repeat(64);

function item(contractId: string, repository: string) {
	return {
		contractId, observedLedger: 65_366_207, instanceModifiedLedger: 65_000_001,
		checkedAt: '2026-11-09T12:00:00.000Z', wasmSha256: digest,
		ledgerEvidence: 'configured_rpc_observation',
		build: { status: 'verified', record: {
			repository, commit, sourceUrl: 'https://github.com/' + repository + '/tree/' + commit,
			workflowUrl: 'https://github.com/' + repository + '/blob/' + commit + '/.github/workflows/build.yml',
			runUrl: null, attestationUrl: 'https://github.com/' + repository + '/attestations/sha256:' + digest
		} },
		independentReproduction: 'not_assessed', securityAudit: 'not_assessed'
	};
}

function reply(items: unknown[] = [], nextCursor: string | null = null, networkPassphrase = publicNetworkPassphrase) {
	return Response.json({ version: 1, networkPassphrase, items, nextCursor });
}

async function render(search: CatalogueSearchParams = {}): Promise<string> {
	const page = await Page({ searchParams: Promise.resolve(search) });
	return new Promise((resolve, reject) => {
		let html = '';
		const output = new Writable({
			write(chunk: Buffer, _encoding, next) { html += chunk.toString(); next(); }
		});
		output.on('finish', () => resolve(html));
		output.on('error', reject);
		const stream = renderToPipeableStream(page, { onAllReady() { stream.pipe(output); }, onError: reject });
	});
}

beforeEach(() => {
	jest.replaceProperty(process, 'env', { ...process.env, STELLAR_ATLAS_PUBLIC_API_URL: 'https://atlas.invalid' });
	fetchMock.mockReset();
	jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);
});
afterEach(() => { jest.restoreAllMocks(); });

test('renders multiple catalogue results with full evidence identities and no per-row requests', async () => {
	fetchMock.mockResolvedValueOnce(reply([item(first, 'Example/build-one'), item(second, 'Example/build-two')], 'next_cursor'));
	const html = await render({ q: ' Example/BUILD ', limit: '10' });
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock).toHaveBeenCalledWith('https://atlas.invalid/v1/contracts/catalogue?q=example%2Fbuild&limit=10',
		expect.objectContaining({ cache: 'no-store' }));
	expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeUndefined();
	expect(html).toContain('2 contracts on this page');
	for (const text of [first, second, commit, digest, 'Stellar Mainnet', '2026-11-09 12:00 UTC',
		'65,366,207', 'Build attested', 'Source reproduction', 'Security audit', 'Not assessed']) {
		expect(html).toContain(text);
	}
	expect(html).toContain('/explorer/contracts/' + first + '?return_to=');
	expect(html).toContain('#build-provenance');
	expect(html).toContain('/explorer/ledgers/65366207?return_to=');
	expect(html).toContain('https://github.com/Example/build-one/tree/' + commit);
	expect(html).toContain('/explorer/verified-contracts?q=example%2Fbuild&amp;limit=10&amp;cursor=next_cursor');
	expect(html).toContain('href="/docs/contract-verification"');
});

test('keeps a shared cursor scoped to its filter and lets users start at the first page', async () => {
	fetchMock.mockResolvedValueOnce(reply([item(second, 'example/build-two')]));
	const html = await render({ q: 'example', limit: '10', cursor: 'next_cursor' });
	expect(fetchMock).toHaveBeenCalledTimes(1);
	expect(fetchMock).toHaveBeenCalledWith('https://atlas.invalid/v1/contracts/catalogue?q=example&limit=10&cursor=next_cursor', expect.anything());
	expect(html).toContain('href="/explorer/verified-contracts?q=example&amp;limit=10">First page');
	expect(html).not.toContain('Next page');
	expect(html).not.toContain('name="cursor"');
});

test('separates an empty exact-address result, an expired page link and a service outage', async () => {
	fetchMock.mockResolvedValueOnce(reply());
	expect(await render({ q: first.toLowerCase() })).toContain('No recorded attestations match this search');
	expect(fetchMock.mock.calls[0]?.[0]).toBe('https://atlas.invalid/v1/contracts/catalogue?q=' + first);
	fetchMock.mockResolvedValueOnce(new Response(null, { status: 400 }));
	expect(await render({ q: 'example', cursor: 'old' })).toContain('This page link is no longer valid for the search');
	fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
	const outage = await render();
	expect(outage).toContain('catalogue is unavailable');
	expect(outage).not.toContain('No build attestations are recorded');
	expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('rejects malformed local controls before fetch and rejects unsupported success claims from the server', async () => {
	expect(await render({ q: ['first', 'second'] })).toContain('Invalid search or page link');
	expect(await render({ limit: '51', cursor: 'with space' })).toContain('Invalid search or page link');
	expect(fetchMock).not.toHaveBeenCalled();
	fetchMock.mockResolvedValueOnce(reply([{ ...item(first, 'example/build'), securityAudit: 'verified' }]));
	const html = await render();
	expect(html).toContain('catalogue is unavailable');
	expect(html).not.toContain(first);
});

test('shows the configured network without making Mainnet detail links for another network', async () => {
	fetchMock.mockResolvedValueOnce(reply([item(first, 'example/test')], null, 'Test SDF Network ; September 2015'));
	const html = await render();
	expect(html).toContain('Stellar Testnet');
	expect(html).toContain(first);
	expect(html).not.toContain('/explorer/contracts/' + first);
	expect(html).not.toContain('/explorer/ledgers/65366207');
});
