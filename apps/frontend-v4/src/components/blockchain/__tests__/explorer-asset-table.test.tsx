import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jest } from '@jest/globals';
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-issuer-metadata', () => ({ ParsedIssuerMetadata: () => null }));
const { AssetTable } = await import('../explorer-asset-views');
it('labels reusable mobile fields without truncating issuer/contract identities or dropping logos/observation links', () => {
	const issuer = 'G' + 'A'.repeat(55), contract = 'C' + 'A'.repeat(55);
	const html = renderToStaticMarkup(createElement(AssetTable, { assets: [
		{ id: 'USD:' + issuer, kind: 'classic', code: 'USD', issuer, logoUrl: '/v1/asset-logos/test.png', firstObservedLedger: 1000, lastObservedLedger: 2000 },
		{ id: contract, kind: 'contract', contractId: contract }
	] }));
	for (const label of ['Asset', 'Type', 'Issuer / contract', 'First observed', 'Last observed']) expect(html).toContain('data-label="' + label + '"');
	for (const value of [issuer, contract, '/explorer/issuers/' + issuer, '/explorer/contracts/' + contract, '/v1/asset-logos/test.png', '/explorer/ledgers/1000', '1,000', '2,000', 'not asset creation dates']) expect(html).toContain(value);
	expect(html).not.toContain('…');
});
