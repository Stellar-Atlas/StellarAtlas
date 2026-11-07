import { jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCurrentAccount, parseCurrentAccountProvider, fetchCurrentAccount } from '../../../api/explorer-current-account';
import { publicNetworkPassphrase } from '../../../api/explorer-current-account-snapshot';
import { currentAccountBreakdown, nativeMinimumReserve } from '../explorer-current-account-breakdown';
import { executeExplorerRequest } from '../explorer-request';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-account-assets.module.css', () => ({ default: {} }));
const { AccountAssetIdentity } = await import('../explorer-account-asset-identity');
const { CurrentAccountInventory, AccountSnapshotEvidence, CurrentAccountProviderLabel, CurrentAccountAbsence } = await import('../explorer-account-assets');
const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const issuer = 'GBDVX4VELCDSQ54KQJYTNHXAHFLBCA77ZY2USQBM4CSHTTV7DME7KALE';
const nativeRow = (balanceRaw: unknown, sellingLiabilitiesRaw?: string) => ({
	assetType: 'native', exact: { assetId: 'native', balanceRaw, sellingLiabilitiesRaw }
});
const creditRow = (code: string, balanceRaw: unknown, extra: Record<string, unknown> = {}) => ({
	assetType: 'credit_alphanum4', assetCode: code, assetIssuer: issuer,
	exact: { assetId: code + ':' + issuer, balanceRaw, ...extra }
});
const accountBody = (balances: readonly unknown[]) => ({
	accountId: account, balances, source: 'horizon', lastModifiedLedger: '100',
	accounting: { scope: 'horizon_account_balances', networkPassphrase: publicNetworkPassphrase,
		snapshotStatus: 'ledger_bound', latestLedger: '101', balanceInventoryComplete: true }
});

it('attributes only a validated public provider hostname and keeps native defaults and exact values', async () => {
	const provider = parseCurrentAccountProvider({ mode: 'operator_alternate', hostname: 'provider.example.org', observedAt: '2026-11-07T20:00:00.000Z' });
	const html = renderToStaticMarkup(<CurrentAccountProviderLabel provider={provider} />);
	expect(html).toContain('provider.example.org');
	expect(html).toContain('Operator-selected alternate');
	expect(html).toContain('Provider response observed');
	expect(renderToStaticMarkup(<CurrentAccountProviderLabel provider={null} />)).toContain('Configured Stellar Horizon service');
	for (const value of [{ mode: 'native', hostname: 'private' }, { mode: 'operator_alternate', hostname: 'http://private/' },
		{ mode: 'operator_alternate', hostname: 'provider.example.org', observedAt: 'bad' }])
		expect(() => parseCurrentAccountProvider(value)).toThrow();
	const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...accountBody([nativeRow('1000000000')]), provider }))
		.mockResolvedValueOnce(Response.json({ error: 'Account not found', provider }, { status: 404 }))
		.mockResolvedValueOnce(Response.json({ error: 'Unavailable', provider }, { status: 503, headers: { 'retry-after': '120' } }));
	try {
		const loaded = await fetchCurrentAccount(account, new AbortController().signal);
		expect(loaded.value?.balances[0]?.balance).toBe(1000000000n);
		expect(loaded.provider?.hostname).toBe('provider.example.org');
		const missing = await fetchCurrentAccount(account, new AbortController().signal);
		expect(missing).toMatchObject({ value: null, provider });
		expect(renderToStaticMarkup(<CurrentAccountAbsence result={missing} failed={false} />)).toContain('Account not found');
		const unavailable = await fetchCurrentAccount(account, new AbortController().signal);
		expect(unavailable).toMatchObject({ status: 'unavailable', provider });
		expect(renderToStaticMarkup(<CurrentAccountAbsence result={unavailable} failed={false} />)).toBe('');
		expect(renderToStaticMarkup(<CurrentAccountAbsence result={missing} failed={true} />)).toBe('');
		expect(await executeExplorerRequest(async () => unavailable, 'generic failure')).toEqual({ ok: false, message: unavailable.message });
	} finally { fetch.mockRestore(); }
});

it('parses exact Horizon units, rejects float or wrong account data, and keeps zero trustlines in the inventory', () => {
	const balances = [nativeRow('9223372036854775807'),
		creditRow('USD', '0', { trustLineLimitRaw: '9223372036854775807', isAuthorized: false }),
		creditRow('EUR', '1')];
	const current = parseCurrentAccount(account, accountBody(balances));
	expect(current.balances.map(row => row.balance)).toEqual([9223372036854775807n, 0n, 1n]);
	expect(current.balances[1]).toMatchObject({ limit: 9223372036854775807n, authorization: 'restricted' });
	expect(() => parseCurrentAccount(issuer, accountBody(balances))).toThrow();
	expect(() => parseCurrentAccount(account, accountBody([]))).toThrow();
	expect(() => parseCurrentAccount(account, accountBody([nativeRow(0.1)]))).toThrow();
	expect(() => parseCurrentAccount(account, accountBody([nativeRow('9223372036854775808')]))).toThrow();
	const html = renderToStaticMarkup(<CurrentAccountInventory value={current} />);
	expect(html).toContain('922,337,203,685.4775807');
	expect(html).toContain('0.0000001');
	expect(html).toContain('Current assets');
	expect(html).not.toContain('/assets/USD');
});

it('uses cached same-origin images only, explicitly attributes the name, and links the full issuer', () => {
	const asset = { id: 'USD:' + issuer, code: 'USD', issuer };
	const logo = '/v1/asset-logos/' + 'a'.repeat(64) + '.png';
	const html = renderToStaticMarkup(<AccountAssetIdentity asset={asset} metadata={{ logoUrl: logo, name: 'Issuer text' }} />);
	expect(html).toContain(logo);
	expect(html.replaceAll('<!-- -->', '')).toContain('Issuer name: Issuer text');
	expect(html).toContain('/explorer/accounts/' + issuer);
	expect(renderToStaticMarkup(<AccountAssetIdentity asset={asset} metadata={{ logoUrl: '//third-party.invalid/logo' }} />)).not.toContain('<img');
});

it('subtracts only sell offers from authorized issued balances, never fabricating XLM reserve', () => {
	const current = parseCurrentAccount(account, accountBody([
		nativeRow('100000000', '12500000'),
		creditRow('USD', '80000001', { sellingLiabilitiesRaw: '12500000', buyingLiabilitiesRaw: '5000000',
			trustLineLimitRaw: '100000000', isAuthorized: true })
	]));
	const [native, issued] = current.balances;
	expect(currentAccountBreakdown(native!, current.snapshot)).toMatchObject({
		available: null, reportedSelling: 12500000n, requiredReserved: null, coveredReserved: null,
		heldForOffers: null, offerShortfall: null, receiveHeadroom: null
	});
	expect(currentAccountBreakdown(issued!, current.snapshot)).toMatchObject({
		available: 67500001n, requiredReserved: 12500000n, coveredReserved: 12500000n,
		heldForOffers: 12500000n, offerShortfall: 0n, receiveHeadroom: 14999999n
	});
	expect(currentAccountBreakdown({ ...issued!, authorization: 'liabilities-only' }, current.snapshot).available).toBeNull();
	expect(currentAccountBreakdown({ ...issued!, selling: null }, current.snapshot).available).toBeNull();
	expect(currentAccountBreakdown({ ...issued!, balance: 1n }, current.snapshot).offerShortfall).toBe(12499999n);
	const html = renderToStaticMarkup(<CurrentAccountInventory value={current} />).replaceAll('<!-- -->', '');
	expect(html).toContain('6.7500001');
	expect(html).toContain('Minimum XLM reserve not calculated');
	expect(html).toContain('Reported sell liabilities: 1.25');
	expect(html).not.toContain('Held for sell offers');
});

it('requires matching ledger and exact weighted sponsorship evidence for native reserve', () => {
	const reserve = {
		latestLedger: '100', baseReserveLedger: '100', baseReserve: 5_000_000n,
		subentries: 3n, sponsoring: 2n, sponsored: 1n
	};
	expect(nativeMinimumReserve(reserve)).toBe(30_000_000n);
	expect(nativeMinimumReserve({ ...reserve, baseReserveLedger: '101' })).toBeNull();
	expect(nativeMinimumReserve({ ...reserve, subentries: null })).toBeNull();
	expect(nativeMinimumReserve({ ...reserve, sponsored: 8n })).toBeNull();
	expect(nativeMinimumReserve({ ...reserve, sponsored: 7n })).toBe(0n);
	const current = parseCurrentAccount(account, accountBody([nativeRow('100000000', '12500000')]));
	const native = current.balances[0]!;
	const snapshot = { ...reserve, closedAt: null, inventoryComplete: true };
	expect(currentAccountBreakdown(native, snapshot)).toMatchObject({
		minimumReserve: 30_000_000n, heldForReserve: 30_000_000n,
		heldForOffers: 12_500_000n, requiredReserved: 42_500_000n, coveredReserved: 42_500_000n, available: 57_500_000n
	});
	expect(currentAccountBreakdown(native, { ...snapshot, baseReserveLedger: '101' }).available).toBeNull();
	expect(currentAccountBreakdown({ ...native, balance: 10_000_000n }, snapshot)).toMatchObject({
		available: 0n, heldForReserve: 10_000_000n, reserveShortfall: 20_000_000n,
		heldForOffers: 0n, offerShortfall: 12_500_000n, requiredReserved: 42_500_000n, coveredReserved: 10_000_000n
	});
	const html = renderToStaticMarkup(<CurrentAccountInventory value={{ ...current, snapshot, balances: [{ ...native, balance: 10_000_000n }] }} />)
		.replaceAll('<!-- -->', '');
	expect(html).toContain('Required: 4.25');
	expect(html).toContain('Covered by balance: 1');
});

it('derives zero only from exact supported trustline evidence and does not infer pool share availability', () => {
	const id = 'a'.repeat(64);
	const current = parseCurrentAccount(account, accountBody([
		nativeRow('100000000'),
		creditRow('USD', '0', { sellingLiabilitiesRaw: '0', isAuthorized: true }),
		creditRow('EUR', '0', { isAuthorized: true }),
		creditRow('GBP', '0', { isAuthorized: false }),
		{ assetType: 'liquidity_pool_shares', exact: { assetId: 'liquidity_pool_shares:' + id,
			liquidityPoolId: id, balanceRaw: '10000000', sellingLiabilitiesRaw: '0' } }
	]));
	const rows = current.balances.slice(1).map(row => currentAccountBreakdown(row, current.snapshot));
	expect(rows.map(r => [r.available, r.requiredReserved, r.coveredReserved]))
		.toEqual([[0n, 0n, 0n], [null, null, null], [null, null, null], [null, null, null]]);
	const html = renderToStaticMarkup(<CurrentAccountInventory value={current} />).replaceAll('<!-- -->', '');
	expect(html).toContain('Shares held: 1');
	expect(html).toContain('Available to withdraw: not assessed');
	expect(html).toContain('Sell-offer reserve: not applicable');
});

it('shows Horizon issuer clawback capability without treating it as a spendability restriction', () => {
	const common = { isAuthorized: true, sellingLiabilitiesRaw: '1' };
	const current = parseCurrentAccount(account, accountBody([
		nativeRow('100000000'),
		creditRow('YES', '10000001', { ...common, isClawbackEnabled: true }),
		creditRow('NO', '10000001', { ...common, isClawbackEnabled: false }),
		creditRow('UNK', '10000001', { ...common, isClawbackEnabled: null })
	]));
	expect(current.balances.slice(1).map(row => row.kind === 'credit' && row.clawbackEnabled)).toEqual([true, false, null]);
	expect(current.balances.slice(1).map(row => currentAccountBreakdown(row, current.snapshot).available))
		.toEqual([10000000n, 10000000n, 10000000n]);
	const html = renderToStaticMarkup(<CurrentAccountInventory value={current} />).replaceAll('<!-- -->', '');
	for (const state of ['Enabled', 'Not enabled', 'Not reported']) expect(html).toContain('Issuer clawback: ' + state);
});

it('binds exact fields and reserve to a public-network Latest-Ledger, and marks a stale snapshot', () => {
	const accounting = {
		scope: 'horizon_account_balances', networkPassphrase: publicNetworkPassphrase, snapshotStatus: 'ledger_bound',
		latestLedger: '101', ledgerClosedAt: '2026-10-10T23:17:07Z', baseReserveRaw: '5000000',
		baseReserveLedger: '101', subentryCount: '3', numSponsoring: '2', numSponsored: '1',
		balanceInventoryComplete: true
	};
	const response = { accountId: account, source: 'horizon', lastModifiedLedger: '100', accounting,
		balances: [{ assetType: 'native', balance: '9999.0', exact: { assetId: 'native', balanceRaw: '100000000', sellingLiabilitiesRaw: '12500000' } }]
	};
	const current = parseCurrentAccount(account, response);
	expect(current.balances[0]?.balance).toBe(100000000n);
	expect(current.snapshot).toMatchObject({ latestLedger: '101', baseReserve: 5_000_000n });
	expect(renderToStaticMarkup(<CurrentAccountInventory value={current} />)).toContain('5.75');
	const evidence = renderToStaticMarkup(<AccountSnapshotEvidence snapshot={current.snapshot!} fetchedAt="2026-11-05T22:00:00Z" />);
	expect(evidence).toContain('/explorer/ledgers/101');
	expect(evidence).toContain('These balances are not current');
	expect(parseCurrentAccount(account, { ...response, accounting: { ...accounting, baseReserveLedger: '100' } }).snapshot.baseReserve).toBeNull();
	expect(parseCurrentAccount(account, { ...response, accounting: { ...accounting, ledgerClosedAt: '2026-02-30T00:00:00Z' } }).snapshot.closedAt).toBeNull();
	expect(() => parseCurrentAccount(account, { ...response, accounting: { ...accounting, networkPassphrase: 'testnet' } })).toThrow();
	expect(() => parseCurrentAccount(account, { ...response, accounting: { ...accounting, latestLedger: '99' } })).toThrow();
	const unbound = parseCurrentAccount(account, { ...response, accounting: {
		...accounting, snapshotStatus: 'ledger_unavailable', latestLedger: null, balanceInventoryComplete: false
	} });
	expect(unbound.snapshot).toMatchObject({ latestLedger: null, baseReserve: null, inventoryComplete: false });
	expect(currentAccountBreakdown(unbound.balances[0]!, unbound.snapshot).available).toBeNull();
	const partial = parseCurrentAccount(account, { ...response, accounting: { ...accounting, balanceInventoryComplete: false },
		balances: [...response.balances, { assetType: 'unsupported', balance: '1' }]
	});
	expect(partial.balances).toHaveLength(1);
	expect(currentAccountBreakdown(partial.balances[0]!, partial.snapshot).minimumReserve).toBeNull();
});
