import express from 'express';
import request from 'supertest';
import { setImmediate as turn } from 'node:timers/promises';
import { registerHubbleContractEventRoutes } from '../HubbleContractEventRoutes.js';
import type { HubbleContractEventPage } from '../HubbleContractEventContracts.js';

it('records only bounded, fixed telemetry after a successful typed event response', async () => {
	const original = process.env.ATLAS_ANALYTICS_ORIGIN;
	const originalFetch = globalThis.fetch;
	const sends: { url: string; init: RequestInit | undefined }[] = [];
	const reject: Array<() => void> = [];
	const finish = (): void => {
		for (const fail of reject.splice(0)) fail();
	};
	try {
		process.env.ATLAS_ANALYTICS_ORIGIN = 'https://analytics.example.test';
		globalThis.fetch = (url, init) => {
			sends.push({ url: String(url), init });
			return new Promise<Response>((_, fail) => {
				reject.push(() => fail(new Error('collector unavailable')));
			});
		};
		const contract = 'CA526Y2NQWGWVVQ7RFFPGAZMU66PSYJ3UC2MTVAV4ZU7OM5BOPHDXUSG';
		const wallet = 'GCX7LOMYJM54CXJPNTDZPMFSTQTQJTR5XR4DKZXLSWJG3R4B7GOADWXZ';
		const app = express();
		const router = express.Router();
		const page: HubbleContractEventPage = {
			contractId: contract, items: [], limit: 1, nextCursor: null,
			elapsedMilliseconds: 0,
			watermark: {
				minimumLedger: 10, maximumLedger: 10, coverage: 'ingested-only',
				observedAt: '2026-01-01T00:00:00Z'
			},
			coverage: {
				contiguousFirstLedger: null, contiguousLastLedger: null,
				contiguousLedgerCount: '0', supplementalLedgerCount: '0',
				totalLedgerCount: '0', nextLedger: '10', minimumLedger: null,
				maximumLedger: null, gapCount: 0
			}
		};
		const warehouse = { contractEvents: async () => page };
		registerHubbleContractEventRoutes(router, warehouse);
		app.use(router);
		const route = `/contracts/${contract}/events`;
		const query = `view=typed&min_ledger=10&max_ledger=10&q=${wallet}`;
		await request(app).get(route + '?view=typed&invalid=body').expect(400);
		expect(sends).toHaveLength(0);
		for (let index = 0; index < 3; index++) {
			const response = await request(app)
				.get(`${route}?${query}`)
				.set('Authorization', 'Bearer private-credential')
				.set('Cookie', 'session=private-cookie')
				.send({ payload: 'private-body' })
				.expect(200);
			expect(response.body).toEqual(page);
		}
		await turn();
		expect(sends).toHaveLength(2);
		for (const { url, init } of sends) {
			expect(url).toBe('https://analytics.example.test/api/event');
			expect(init).toMatchObject({
				method: 'POST', credentials: 'omit', redirect: 'error',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'StellarAtlasTelemetry/1.0'
				}
			});
			expect(JSON.parse(String(init?.body))).toEqual({
				domain: 'stellaratlas.io',
				name: 'Successful event query',
				url: 'https://stellaratlas.io/explorer/contract-events'
			});
		}
		finish();
		await turn();
		await request(app).get(`${route}?${query}`).expect(200, page);
		await turn();
		expect(sends).toHaveLength(3);
	} finally {
		finish();
		await turn();
		globalThis.fetch = originalFetch;
		if (original === undefined) delete process.env.ATLAS_ANALYTICS_ORIGIN;
		else process.env.ATLAS_ANALYTICS_ORIGIN = original;
	}
});
