import { expect, it, jest } from '@jest/globals';
import { renderToStaticMarkup } from 'react-dom/server';

jest.unstable_mockModule('@components/blockchain/explorer-entity.module.css', () => ({ default: {} }));
jest.unstable_mockModule('@components/blockchain/explorer-contract-provenance.module.css', () => ({ default: {} }));
const { default: Page, metadata } = await import('../page');

it('leaves public checking and catalogue links available before session confirmation', async () => {
	const html = renderToStaticMarkup(await Page({
		searchParams: Promise.resolve({ signIn: 'complete' })
	}));
	expect(metadata.referrer).toBe('no-referrer');
	expect(html).toContain('href="/explorer/verified-contracts"');
	expect(html).toContain('Open build checker');
	expect(html).toContain('Checking GitHub sign-in');
	expect(html).toContain('Saved submissions are not available');
	expect(html).not.toContain('Signed in with GitHub');
});
