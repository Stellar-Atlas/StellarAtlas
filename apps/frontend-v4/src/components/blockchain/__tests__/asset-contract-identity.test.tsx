import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Asset } from '../explorer-asset-types';
import { parseAsset } from '../asset-data';

let search = 'tab=contracts-events&min_ledger=100&max_ledger=101';
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const explicit = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const activity = jest.fn(({ contractId }: { contractId: string }) => createElement('div', { 'data-contract': contractId }));
jest.unstable_mockModule('next/navigation', () => ({ usePathname: () => '/explorer/assets/native', useSearchParams: () => new URLSearchParams(search) }));
jest.unstable_mockModule('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement('a', { href }, children) }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-issuer-metadata', () => ({ ParsedIssuerMetadata: () => null }));
jest.unstable_mockModule('../explorer-asset-holders', () => ({ ExplorerAssetHolders: () => null }));
jest.unstable_mockModule('../explorer-asset-markets', () => ({ ExplorerAssetMarkets: () => null }));
jest.unstable_mockModule('../explorer-asset-activity', () => ({ ExplorerAssetActivity: () => null }));
jest.unstable_mockModule('../explorer-similar-assets', () => ({ ExplorerSimilarAssets: () => null }));
jest.unstable_mockModule('../explorer-asset-reports', () => ({ ExplorerAssetReports: () => null }));
jest.unstable_mockModule('../explorer-contract-activity', () => ({ ExplorerContractActivity: activity }));
const { ExplorerAssetTabs } = await import('../explorer-asset-tabs');
const render = (asset: Asset) => renderToStaticMarkup(createElement(ExplorerAssetTabs, { record: { asset } }));
beforeEach(() => { activity.mockClear(); search = 'tab=contracts-events&min_ledger=100&max_ledger=101'; });

it('renders accessible concise feedback for permitted missing classic/native identities without mounting activity', () => {
	for (const input of [{ id: 'native', kind: 'native' }, { id: 'USD:' + issuer, kind: 'classic', issuer }]) {
		const html = render(parseAsset(input));
		expect(html).toContain('aria-label="Contract activity"');
		expect(html).toContain('role="status">Contract address unavailable for this asset.');
		expect(html).not.toMatch(/undeployed|no activity|no events/i);
	}
	expect(activity).not.toHaveBeenCalled();
});
it('reuses a checksum-valid contract asset identity when its optional duplicate field is absent', () => {
	const html = render(parseAsset({ id: contract, kind: 'contract' }));
		expect(html).toContain('href="/explorer/contracts/' + contract + '"');
		expect(activity).toHaveBeenCalledWith(expect.objectContaining({ contractId: contract, filters: {}, token: undefined }), undefined);
	expect(html).not.toContain('Contract address unavailable');
});
it('preserves explicit classic SAC identity and exact token context', () => {
	const asset = parseAsset({ id: 'USD:' + issuer, kind: 'classic', code: 'USD', issuer, contractId: explicit });
	const html = render(asset);
		expect(html).toContain('Stellar Asset Contract activity');
		expect(activity.mock.calls[0]?.[0]).toEqual({ contractId: explicit, filters: {}, token: { contractId: explicit, assetId: asset.id, symbol: 'USD', decimals: 7 } });
});
it('keeps an explicit contract address authoritative and rejects an invalid fallback identity', () => {
	render(parseAsset({ id: contract, kind: 'contract', contractId: explicit }));
	expect(activity.mock.calls[0]?.[0]).toEqual({ contractId: explicit, filters: {}, token: undefined });
	activity.mockClear();
	expect(render(parseAsset({ id: 'C' + 'A'.repeat(55), kind: 'contract' }))).toContain('Contract address unavailable');
	expect(activity).not.toHaveBeenCalled();
});
it('does not show missing-contract feedback or mount activity on another asset tab', () => {
	search = 'tab=transfers';
	expect(render(parseAsset({ id: 'native', kind: 'native' }))).not.toContain('Contract address unavailable');
	expect(activity).not.toHaveBeenCalled();
});
