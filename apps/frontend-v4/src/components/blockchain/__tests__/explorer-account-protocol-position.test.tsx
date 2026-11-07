import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseAccountProtocolPosition } from '../../../api/explorer-account-protocol-position';
import { protocolPositionAssetContract, protocolPositionCoverage, protocolPositionPool } from '../../../domain/account-protocol-position';
import { GET } from '../../../app/api/explorer/protocol-positions/[account]/route';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
const { ExplorerAccountProtocolPosition, ProtocolPositionEvidence } = await import('../explorer-account-protocol-position');

const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const scope = {
	network: 'mainnet', accountId: account, coverage: protocolPositionCoverage, includedInCurrentTotals: false,
	target: { poolId: protocolPositionPool, assetId: 'native', assetContractId: protocolPositionAssetContract, reserveIndex: 0 }
};
const asOf = { ledger: 65000000, ledgerHash: 'a'.repeat(64), closedAt: '2026-11-06T03:10:41.000Z', ageSeconds: 1800, freshness: 'historical' };
const underlyingEstimate = { kind: 'stored_rate', amountRaw: '1', decimals: 7, rateRaw: '1000103544200', rateDecimals: 12,
	rateUpdatedAtEpochSeconds: String(Date.parse(asOf.closedAt) / 1000 - 10) };
const position = { supplySharesRaw: '1', supplyShareDecimals: 7, underlyingEstimate, balanceScope: 'separate_protocol_supply', withdrawal: 'unknown' };
const observed = { ...scope, status: 'observed', asOf, position };
const render = (status: number, payload: unknown) =>
	renderToStaticMarkup(<ProtocolPositionEvidence result={parseAccountProtocolPosition(account, status, payload)} />).replaceAll('<!-- -->', '');

it('keeps exact historical and observed-zero quantities distinct from missing evidence and valid 503', () => {
	const html = render(200, observed);
	expect(html).toContain('Historical observation');
	expect(html).toContain('/explorer/ledgers/65000000');
	expect(html).toContain('0.0000001 XLM');
	expect(html).toContain('Withdrawal amount not assessed');
	expect(render(200, { ...observed, asOf: { ...asOf, freshness: 'recent' },
		position: { ...position, supplySharesRaw: '0', underlyingEstimate: { ...underlyingEstimate, amountRaw: '0' } } })).toContain('0 XLM');
	const missing = render(200, { ...scope, status: 'unobserved', asOf });
	expect(missing).toContain('does not establish a zero balance');
	expect(missing).not.toContain('Estimated underlying');
	expect(render(503, { ...scope, status: 'unavailable', asOf: null })).toContain('Saved protocol evidence is unavailable');
});

it('rejects invalid scope, reserve, amount, ledger timestamp, rate time and status combinations', () => {
	for (const payload of [
		{ ...observed, accountId: 'wrong' }, { ...observed, includedInCurrentTotals: true },
		{ ...observed, target: { ...scope.target, reserveIndex: 1 } },
		{ ...observed, asOf: { ...asOf, closedAt: '2026-02-30T00:00:00.000Z' } },
		{ ...observed, position: { ...position, underlyingEstimate: { ...underlyingEstimate, amountRaw: '2' } } },
		{ ...observed, position: { ...position, underlyingEstimate: { ...underlyingEstimate, rateUpdatedAtEpochSeconds: '9999999999' } } },
		{ ...observed, status: 'unobserved' }
	]) expect(() => parseAccountProtocolPosition(account, 200, payload)).toThrow('Invalid protocol position evidence');
	expect(() => parseAccountProtocolPosition(account, 503, { error: 'private' })).toThrow();
});

it('does not fetch during render and forwards only a permitted account to the fixed route when enabled', async () => {
	const flag = process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS;
	const base = process.env.STELLAR_ATLAS_PUBLIC_API_URL;
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ...scope, status: 'unavailable', asOf: null }, { status: 503 }));
	const url = 'https://atlas.invalid/api/explorer/protocol-positions/' + account;
	const params = Promise.resolve({ account });
	try {
		expect(renderToStaticMarkup(<ExplorerAccountProtocolPosition account={account} />)).toContain('Load saved observation');
		delete process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS;
		expect((await GET(new Request(url), { params })).status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
		process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS = '1';
		process.env.STELLAR_ATLAS_PUBLIC_API_URL = 'http://127.0.0.1:3099';
		expect((await GET(new Request(url + '?ledger=1'), { params })).status).toBe(400);
		const response = await GET(new Request(url), { params });
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toMatchObject({ status: 'unavailable', accountId: account });
		expect(fetch.mock.calls.map(([request]) => request)).toEqual(['http://127.0.0.1:3099/v1/explorer/accounts/' + account + '/protocol-positions']);
	} finally {
		fetch.mockRestore();
		if (flag === undefined) delete process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS; else process.env.STELLAR_ATLAS_ACCOUNT_PROTOCOL_POSITIONS = flag;
		if (base === undefined) delete process.env.STELLAR_ATLAS_PUBLIC_API_URL; else process.env.STELLAR_ATLAS_PUBLIC_API_URL = base;
	}
});
