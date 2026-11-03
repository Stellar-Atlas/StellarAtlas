import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import type { Asset } from '../explorer-asset-types';

jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: { assetTitle: 'assetTitle' } }));
jest.unstable_mockModule('../explorer-issuer-metadata', () => ({ ParsedIssuerMetadata: () => null }));
const { AssetDetails } = await import('../explorer-asset-views');
const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
const explicit = 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
const render = (asset: Asset) => renderToStaticMarkup(createElement(AssetDetails, { record: { asset }, pending: false, onRefresh: () => undefined }));
const heading = (asset: Asset) => render(asset).match(/<h3>(.*?)<\/h3>/s)?.[1];

it('shows the full established contract-kind C id when code and explicit address are absent', () => {
	expect(heading({ id: contract, kind: 'contract' })).toBe(contract);
	expect(render({ id: contract, kind: 'contract' })).not.toContain('…');
});
it('preserves ordinary code and explicit contract title precedence', () => {
	expect(heading({ id: contract, kind: 'contract', code: 'TOKEN', contractId: explicit })).toBe('TOKEN');
	expect(heading({ id: contract, kind: 'contract', contractId: explicit })).toBe(explicit);
	expect(heading({ id: 'native', kind: 'native', code: 'XLM' })).toBe('XLM');
	expect(heading({ id: 'USD:GISSUER', kind: 'classic', code: 'USD', contractId: explicit })).toBe('USD');
});
it('keeps genuinely unknown and invalid-checksum identities generic instead of inventing a title', () => {
	for (const asset of [{ id: 'C' + 'A'.repeat(55), kind: 'contract' as const }, { id: 'unknown', kind: 'contract' as const }, { id: contract, kind: 'classic' as const }])
		expect(heading(asset)).toBe('Asset');
});
it('keeps title text escaped rather than treating code or explicit address as markup', () => {
	for (const asset of [{ id: contract, kind: 'contract' as const, code: '<script>alert(1)</script>' }, { id: contract, kind: 'contract' as const, contractId: '<img src=x onerror=alert(1)>' }]) {
		expect(heading(asset)).toContain('&lt;');
		expect(heading(asset)).not.toMatch(/<script|<img/);
	}
});
it('retains the existing long-title wrapping contract without changing responsive styling', () => {
	expect(render({ id: contract, kind: 'contract' })).toContain('class="assetTitle"');
	const css = readFileSync(new URL('../explorer-asset-workspace.module.css', import.meta.url), 'utf8');
	expect(css).toMatch(/\.assetTitle,\s*\.assetTitle > div\s*\{\s*min-width:\s*0;/);
	expect(css).toMatch(/\.assetTitle h3\s*\{\s*overflow-wrap:\s*anywhere;/);
});
