/// <reference types="jest" />
/// <reference types="node" />

import { fetchHistoryArchiveRepairPlanForArchive } from '../archive-scans-client';

describe('archive scans client', () => {
	it('requests the backend-compatible default repair-plan limit', async () => {
		const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
		const originalApiUrl = process.env.STELLAR_ATLAS_PUBLIC_API_URL;
		const fetchCalls: Array<Parameters<typeof fetch>> = [];
		const plan = {
			actionCount: 0,
			actions: [],
			archiveUrl: 'https://history.example.com',
			archiveUrlIdentity: 'https://history.example.com',
			generatedAt: '2026-08-16T00:00:00.000Z',
			infrastructureBlocks: [],
			limit: 50,
			summary: {
				activeObjectChecks: 0,
				failedCheckpointProofs: 0,
				failedObjectChecks: 0,
				pendingObjectChecks: 0,
				verifiedObjectChecks: 1
			}
		};
		process.env.STELLAR_ATLAS_PUBLIC_API_URL = 'http://api.test';
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			value: (async (...args: Parameters<typeof fetch>) => {
				fetchCalls.push(args);
				return {
					json: async () => plan,
					ok: true,
					status: 200
				} as Response;
			}) satisfies typeof fetch
		});

		try {
			await expect(
				fetchHistoryArchiveRepairPlanForArchive('https://history.example.com')
			).resolves.toEqual(plan);
			expect(fetchCalls[0]?.[0]).toBe(
				'http://api.test/v1/archive-scans/https%3A%2F%2Fhistory.example.com/repair-plan?limit=50'
			);
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
