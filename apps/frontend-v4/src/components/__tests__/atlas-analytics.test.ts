import { expect, it, jest } from '@jest/globals';
import {
	atlasPageLabel, atlasRouteEvent, atlasSafeReferrer, recordAtlasPageview,
	recordAtlasView, setAtlasAnalyticsOptOut
} from '../atlas-analytics';

it('sends fixed browser actions without paths, referrers, credentials or retries', async () => {
	const original = process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
	const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const send = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('collector offline'));
	try {
		Object.defineProperty(globalThis, 'navigator', {
			configurable: true,
			value: { globalPrivacyControl: true }
		});
		process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN = 'https://analytics.example.test';
		recordAtlasView('docs');
		expect(send).not.toHaveBeenCalled();
		Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
		process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN = 'https://user:pass@analytics.example.test/?key=private';
		recordAtlasView('docs');
		expect(send).not.toHaveBeenCalled();
		process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN = 'https://analytics.example.test';
		expect(recordAtlasView('docs')).toBeUndefined();
		expect(recordAtlasView('archives')).toBeUndefined();
		recordAtlasPageview('/explorer/contracts/private-contract-1', 'https://www.google.com/search?q=private');
		recordAtlasPageview('/explorer/contracts/private-contract-2', 'https://private.example.com/secret');
		recordAtlasPageview('/explorer/contracts/private-contract-3?token=private', '');
		setAtlasAnalyticsOptOut(true);
		recordAtlasView('docs');
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(send).toHaveBeenCalledTimes(4);
		const payloads = send.mock.calls.map(([endpoint, options]) => {
			expect(String(endpoint)).toBe('https://analytics.example.test/api/event');
			expect(options).toMatchObject({
				method: 'POST', mode: 'cors', credentials: 'omit',
				referrerPolicy: 'no-referrer', redirect: 'error',
				headers: { 'Content-Type': 'text/plain' }
			});
			expect(options?.signal?.aborted).toBe(true);
			return JSON.parse(String(options?.body));
		});
		expect(payloads).toEqual([
			{ domain: 'stellaratlas.io', name: 'Documentation use', url: 'https://stellaratlas.io/docs' },
			{ domain: 'stellaratlas.io', name: 'Archive inspection', url: 'https://stellaratlas.io/archives' },
			{ domain: 'stellaratlas.io', name: 'pageview', url: 'https://stellaratlas.io/explorer/contracts/_detail', referrer: 'https://google.com' },
			{ domain: 'stellaratlas.io', name: 'pageview', url: 'https://stellaratlas.io/explorer/contracts/_detail' }
		]);
	} finally {
		setAtlasAnalyticsOptOut(false);
		send.mockRestore();
		if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
		if (original === undefined) delete process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
		else process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN = original;
	}
});

it('reduces known explorer routes to fixed categories without retaining identifiers', () => {
	expect(atlasRouteEvent('/')).toBe('network');
	expect(atlasRouteEvent('/nodes/private-key')).toBe('network');
	expect(atlasRouteEvent('/explorer/contracts')).toBe('explorerList');
	expect(atlasRouteEvent('/explorer/markets')).toBe('explorerList');
	expect(atlasRouteEvent('/explorer/verified-contracts')).toBe('explorerList');
	expect(atlasRouteEvent('/explorer/soroban-domains')).toBe('explorerList');
	expect(atlasRouteEvent('/explorer/issuers/by-domain')).toBe('explorerList');
	expect(atlasRouteEvent('/explorer/issuers/private-key')).toBe('explorerRecord');
	expect(atlasRouteEvent('/explorer/issuers/by-domain/extra')).toBeNull();
	expect(atlasRouteEvent('/explorer/contracts/private-address')).toBe('explorerRecord');
	expect(atlasRouteEvent('/explorer/transactions/private-hash')).toBe('explorerRecord');
	expect(atlasRouteEvent('/explorer/unknown/private-address')).toBeNull();
	expect(atlasRouteEvent('/explorer/transactions/private-hash/unmatched')).toBeNull();
	expect(atlasRouteEvent('/docs/graphql')).toBeNull();
	expect(atlasRouteEvent('/status')).toBeNull();
	expect(atlasPageLabel('/archive-scans/private/root')).toBe('/archive-scans/_detail');
	expect(atlasPageLabel('/docs/api/private-operation')).toBe('/docs/api/_operation');
	expect(atlasPageLabel('/privacy')).toBe('/privacy');
	expect(atlasPageLabel('/verification/review')).toBe('/verification/review');
	expect(atlasPageLabel('/api/explorer/private')).toBeUndefined();
	expect(atlasSafeReferrer('https://discuss.stellar.community/private?q=wallet')).toBe('https://stellar.community');
	expect(atlasSafeReferrer('https://acct-92741123.customers.vendor.com/private')).toBe('https://vendor.com');
	expect(atlasSafeReferrer('https://acct-92741123.hosted.vendor.co.uk/private')).toBe('https://vendor.co.uk');
	expect(atlasSafeReferrer('https://tenant.pages.dev/private')).toBe('https://pages.dev');
	expect(atlasSafeReferrer('https://a'.padEnd(63, 'a') + '.github.com/private')).toBe('https://github.com');
	expect(atlasSafeReferrer('https://api.stellaratlas.io/private')).toBeUndefined();
	expect(atlasSafeReferrer('https://service.internal/private')).toBeUndefined();
	expect(atlasSafeReferrer('https://192.0.2.11/private')).toBeUndefined();
	expect(atlasSafeReferrer('https://attacker@github.com/private')).toBeUndefined();
});
