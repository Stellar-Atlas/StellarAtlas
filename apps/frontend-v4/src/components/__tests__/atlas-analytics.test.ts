import { expect, it, jest } from '@jest/globals';
import { recordAtlasView } from '../atlas-analytics';

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
		recordAtlasView('docs');
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(send).toHaveBeenCalledTimes(2);
		const payloads = send.mock.calls.map(([endpoint, options]) => {
			expect(String(endpoint)).toBe('https://analytics.example.test/api/event');
			expect(options).toMatchObject({
				method: 'POST', mode: 'no-cors', credentials: 'omit',
				referrerPolicy: 'no-referrer', redirect: 'error',
				headers: { 'Content-Type': 'text/plain' }
			});
			return JSON.parse(String(options?.body));
		});
		expect(payloads).toEqual([
			{ domain: 'stellaratlas.io', name: 'Documentation use', url: 'https://stellaratlas.io/docs' },
			{ domain: 'stellaratlas.io', name: 'Archive inspection', url: 'https://stellaratlas.io/archives' }
		]);
	} finally {
		send.mockRestore();
		if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
		else Reflect.deleteProperty(globalThis, 'navigator');
		if (original === undefined) delete process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN;
		else process.env.NEXT_PUBLIC_ATLAS_ANALYTICS_ORIGIN = original;
	}
});
