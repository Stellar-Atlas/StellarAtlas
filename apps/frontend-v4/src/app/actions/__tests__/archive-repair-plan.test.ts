/// <reference types="jest" />
/// <reference types="node" />

import { loadArchiveRepairPlan } from '../archive-repair-plan';

describe('archive repair plan action', () => {
	it('loads the typed per-archive repair endpoint and rejects credentialed URLs', async () => {
		const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
		const originalApiUrl = process.env.STELLAR_ATLAS_PUBLIC_API_URL;
		const plan = {
			actionCount: 0,
			actions: [],
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			generatedAt: '2026-07-11T00:00:00.000Z',
			infrastructureBlocks: [],
			limit: 100,
			summary: {
				activeObjectChecks: 0,
				failedCheckpointProofs: 0,
				failedObjectChecks: 0,
				pendingObjectChecks: 0,
				verifiedObjectChecks: 1
			}
		};
		const fetchCalls: Array<Parameters<typeof fetch>> = [];
		const fetchMock: typeof fetch = async (...args) => {
			fetchCalls.push(args);
			return Promise.resolve({
				json: async () => plan,
				ok: true,
				status: 200
			} as Response);
		};
		process.env.STELLAR_ATLAS_PUBLIC_API_URL = 'http://api.test';
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: fetchMock
		});

		try {
			await expect(
				loadArchiveRepairPlan('https://history.example.com')
			).resolves.toEqual({ plan, status: 'loaded' });
			expect(fetchCalls[0]?.[0]).toBe(
				'http://api.test/v1/archive-scans/https%3A%2F%2Fhistory.example.com/repair-plan?limit=100'
			);
			expect(fetchCalls[0]?.[1]).toEqual(
				expect.objectContaining({ cache: 'no-store' })
			);
			await expect(
				loadArchiveRepairPlan('https://user:secret@history.example.com')
			).resolves.toMatchObject({ plan: null, status: 'invalid' });
			expect(fetchCalls).toHaveLength(1);
		} finally {
			if (originalApiUrl === undefined) {
				delete process.env.STELLAR_ATLAS_PUBLIC_API_URL;
			} else {
				process.env.STELLAR_ATLAS_PUBLIC_API_URL = originalApiUrl;
			}
			if (originalFetch === undefined) {
				Reflect.deleteProperty(globalThis, 'fetch');
			} else {
				Object.defineProperty(globalThis, 'fetch', originalFetch);
			}
		}
	});
});
