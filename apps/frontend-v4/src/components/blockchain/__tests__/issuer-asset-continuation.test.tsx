import { jest } from '@jest/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssetPage } from '../explorer-asset-types';

let route = new URL('https://explorer.invalid/explorer/issuers/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
jest.unstable_mockModule('next/navigation', () => ({ usePathname: () => route.pathname, useSearchParams: () => route.searchParams }));
jest.unstable_mockModule('../explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('../explorer-asset-workspace.module.css', () => ({ default: {} }));
const { IssuerDetails } = await import('../explorer-asset-views');
const { ExplorerInvestigation } = await import('../explorer-investigation');
const issuer = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const original = '/explorer/issuers?q=issuer.example';
const record = { asset: { id: issuer, issuer, kind: 'classic' as const } };
const render = (assets: AssetPage | null) => renderToStaticMarkup(createElement(ExplorerInvestigation, {
  children: createElement(IssuerDetails, { issuerId: issuer, record, assets, onRefresh: () => undefined, pending: false })
}));
const browseUrl = (html: string) => {
  const match = html.match(/href="([^"]+)">Browse issuer assets<\/a>/);
  if (!match?.[1]) throw new Error('Missing issuer-scoped continuation');
  return new URL(match[1].replaceAll('&amp;', '&'), 'https://explorer.invalid');
};

it('labels a bounded preview and continues into the same issuer without leaking preview cursor', () => {
  route = new URL('/explorer/issuers/' + issuer + '?return_to=' + encodeURIComponent(original), 'https://explorer.invalid');
  const html = render({ data: [{ id: 'USD:' + issuer, issuer, code: 'USD', kind: 'classic' }], nextCursor: 'opaque_preview_cursor' });
  expect(html).toContain('1 shown · More available');
  const url = browseUrl(html);
  expect(url.pathname).toBe('/explorer/assets');
  expect(url.searchParams.get('issuer')).toBe(issuer);
  expect(url.searchParams.get('return_to')).toBe(original);
  expect(url.searchParams.has('cursor')).toBe(false);
  expect(html).not.toContain('Browse all assets');
});

it('does not claim more assets or a complete total when the preview has no cursor', () => {
  route = new URL('/explorer/issuers/' + issuer, 'https://explorer.invalid');
  const html = render({ data: [], nextCursor: null });
  expect(html).toContain('0 shown');
  expect(html).not.toContain('More available');
  expect(html).not.toContain('total');
  expect(browseUrl(html).searchParams.get('return_to')).toBe('/explorer/issuers/' + issuer);
});

it('rejects an external return target while keeping issuer discovery scoped', () => {
  route = new URL('/explorer/issuers/' + issuer + '?return_to=' + encodeURIComponent('https://evil.invalid/'), 'https://explorer.invalid');
  const url = browseUrl(render(null));
  expect(url.searchParams.get('issuer')).toBe(issuer);
  expect(url.searchParams.get('return_to')).toBe('/explorer/issuers/' + issuer);
});
