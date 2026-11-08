import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchClaimablePage, parseClaimablePage } from '../../../api/explorer-claimable-positions';
import { publicNetworkPassphrase } from '../../../api/explorer-current-account-snapshot';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-claimable-positions.module.css', () => ({ default: {} }));
const { ExplorerClaimablePositions, ClaimableProviderEvidence } = await import('../explorer-claimable-positions');
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const other = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const claim = {
	id: '00000000' + '1'.repeat(64), assetId: 'native', amount: '922337203685.4775807', amountRaw: '9223372036854775807',
	sponsor: account, roles: ['claimant', 'sponsor'], lastModifiedLedger: '100', lastModifiedAt: '2026-11-05T21:00:00Z',
	claimants: [
		{ destination: account, predicate: { type: 'not', predicate: { type: 'before_relative_time', seconds: '9223372036854775807' } } },
		{ destination: other, predicate: { type: 'unconditional' } }
	]
};
const payload = {
	transmission: 'native', observation: { observedAt: '2026-11-08T00:00:00.000Z', networkStatus: 'unconfirmed', freshness: 'unknown', latestLedgerClosedAt: null },
	source: 'horizon', networkPassphrase: publicNetworkPassphrase, accountId: account, role: 'claimant',
	latestLedger: '101', snapshotStatus: 'ledger_bound', pageStatus: 'available', positions: [claim], nextCursor: 'page_2'
};

it('keeps exact principal and both roles, de-duplicates identical IDs, and preserves competing conditions', () => {
	const page = parseClaimablePage(account, 'claimant', { ...payload, positions: [claim, structuredClone(claim)] });
	expect(page).toMatchObject({ latestLedger: '101', partial: true, nextCursor: 'page_2' });
	expect(page.positions).toHaveLength(1);
	expect(page.positions[0]).toMatchObject({ amountRaw: claim.amountRaw, roles: claim.roles, claimants: claim.claimants });
});

it('rejects conflicting repeats in either order even when each record is valid on its own', () => {
	const first = { ...claim, amount: '1.0000000', amountRaw: '10000000' };
	const changes = [
		{ amount: '2.0000000', amountRaw: '20000000' },
		{ sponsor: other, roles: ['claimant'] },
		{ claimants: [claim.claimants[0], { destination: other, predicate: { type: 'before_relative_time', seconds: '60' } }] },
		{ lastModifiedLedger: '99' },
		{ lastModifiedAt: '2026-11-05T21:01:00Z' }
	];
	for (const change of changes) {
		const second = { ...first, ...change };
		expect(parseClaimablePage(account, 'claimant', { ...payload, positions: [second] }).positions).toHaveLength(1);
		for (const positions of [[first, second], [second, first]])
			expect(() => parseClaimablePage(account, 'claimant', { ...payload, positions })).toThrow('Invalid claimable positions');
	}
});

it('rejects contradictory scope, principal, role, and snapshot evidence', () => {
	for (const candidate of [
		{ ...payload, networkPassphrase: 'wrong' },
		{ ...payload, role: 'sponsor' },
		{ ...payload, nextCursor: 'https://invalid/' },
		{ ...payload, latestLedger: '99' },
		{ ...payload, positions: [{ ...claim, sponsor: other }] },
		{ ...payload, positions: [{ ...claim, amountRaw: '1' }] }
	]) expect(() => parseClaimablePage(account, 'claimant', candidate)).toThrow('Invalid claimable positions');
	expect(parseClaimablePage(account, 'claimant', {
		...payload, latestLedger: null, snapshotStatus: 'ledger_unavailable', positions: [], nextCursor: null
	})).toMatchObject({ latestLedger: null, positions: [] });
});

it('does not request a page on initial render, and distinguishes unsupported from a failed read', async () => {
	const fetch = jest.spyOn(globalThis, 'fetch');
	try {
		expect(renderToStaticMarkup(<ExplorerClaimablePositions account={account} />)).toContain('View claimable positions');
		expect(fetch).not.toHaveBeenCalled();
		fetch.mockResolvedValueOnce(Response.json({}, { status: 501 })).mockResolvedValueOnce(Response.json({}, { status: 502 }));
		const { signal } = new AbortController();
		await expect(fetchClaimablePage(account, 'sponsor', null, signal)).resolves.toMatchObject({ status: 'unsupported', provider: null });
		await expect(fetchClaimablePage(account, 'claimant', 'page_2', signal)).resolves.toMatchObject({ status: 'unavailable' });
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1]?.[0]).toBe('/api/explorer/claimable-positions/' + account + '?role=claimant&cursor=page_2');
	} finally { fetch.mockRestore(); }
});

it('validates provider/transmission and unknown freshness without treating observation time as chain freshness', () => {
 const provider = { mode: 'operator_alternate', hostname: 'provider.example.org', observedAt: payload.observation.observedAt };
 const page = parseClaimablePage(account, 'claimant', { ...payload, provider, transmission: 'operator_alternate' });
 const html = renderToStaticMarkup(<ClaimableProviderEvidence value={page} />);
 expect(html).toContain('provider.example.org');
 expect(html).toContain('Atlas sent this account address');
 expect(html).toContain('response observation time');
 expect(html).toContain('not independently confirmed');
 for (const bad of [ { provider, transmission: 'native' }, { provider: { ...provider, hostname: 'evil/path' }, transmission: 'operator_alternate' },
  { observation: { ...payload.observation, freshness: 'fresh' } }, { observation: { ...payload.observation, networkStatus: 'verified' } },
  { observation: { ...payload.observation, observedAt: null } }, { observation: { ...payload.observation, latestLedgerClosedAt: payload.observation.observedAt } } ])
  expect(() => parseClaimablePage(account, 'claimant', { ...payload, ...bad })).toThrow();
});

it('retains validated attribution on provider cooldown and unsupported responses without browser-direct provider calls', async () => {
 const provider = { mode: 'operator_alternate', hostname: 'provider.example.org' };
 const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ provider, transmission: 'operator_alternate' }, { status: 503, headers: { 'Retry-After': '120' } }))
  .mockResolvedValueOnce(Response.json({ provider, transmission: 'operator_alternate' }, { status: 501 }));
 try {
  const failure = await fetchClaimablePage(account, 'claimant', null, new AbortController().signal);
  expect(failure).toMatchObject({ status: 'unavailable', provider, retryAfterSeconds: 120 });
  expect(renderToStaticMarkup(<ClaimableProviderEvidence value={failure} />)).toContain('provider.example.org');
  expect(await fetchClaimablePage(account, 'sponsor', null, new AbortController().signal)).toMatchObject({ status: 'unsupported', provider });
  expect(fetch.mock.calls.every(call => String(call[0]).startsWith('/api/explorer/claimable-positions/'))).toBe(true);
 } finally { fetch.mockRestore(); }
});
