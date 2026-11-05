import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchClaimablePage, parseClaimablePage } from '../../../api/explorer-claimable-positions';
import { publicNetworkPassphrase } from '../../../api/explorer-current-account-snapshot';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-claimable-positions.module.css', () => ({ default: {} }));
const { ExplorerClaimablePositions } = await import('../explorer-claimable-positions');
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
	source: 'horizon', networkPassphrase: publicNetworkPassphrase, accountId: account, role: 'claimant',
	latestLedger: '101', snapshotStatus: 'ledger_bound', pageStatus: 'available', positions: [claim], nextCursor: 'page_2'
};

it('keeps exact principal and both roles, de-duplicates IDs, and preserves competing conditions', () => {
	const page = parseClaimablePage(account, 'claimant', { ...payload, positions: [claim, claim] });
	expect(page).toMatchObject({ latestLedger: '101', partial: true, nextCursor: 'page_2' });
	expect(page.positions).toHaveLength(1);
	expect(page.positions[0]).toMatchObject({ amountRaw: claim.amountRaw, roles: claim.roles, claimants: claim.claimants });
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
		await expect(fetchClaimablePage(account, 'sponsor', null, signal)).resolves.toBe('unsupported');
		await expect(fetchClaimablePage(account, 'claimant', 'page_2', signal)).rejects.toThrow();
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[1]?.[0]).toBe('/api/explorer/claimable-positions/' + account + '?role=claimant&cursor=page_2');
	} finally { fetch.mockRestore(); }
});
