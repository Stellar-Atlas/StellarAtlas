import { readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from '../HubbleWarehouseErrors.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';

const account = 'GASNOA72CECDUZ5GEUK6WFINSASEG6R3WYZB2DE2CGDU7YI7GC2QPSFX';
describe('primary analytics routing', () => {
	it('mounts one parsed analytics router and removes only the shadowed compatibility mount', () => {
		const source = readFileSync(
			new URL('../../../../core/infrastructure/http/api.ts', import.meta.url),
			'utf8'
		);
		expect(source).not.toContain('historyAnalyticsRouter');
		expect(source.match(/hubbleWarehouseRouter\(/g)).toHaveLength(1);
		expect(source).toContain(
			"api.all('/graphql', hubbleWarehouseGraphqlHandler(hubbleWarehouse))"
		);
	});
	it('keeps the public holder route on the parsed reader for success, absence and failure', async () => {
		const warehouse = mock<HubbleWarehouse>();
		const page = {
			asset: 'native',
			elapsedMilliseconds: 1,
			limit: 1,
			nextCursor: null,
			holders: [{ account, balance: 730.3194445 }],
			coverage: summarizeHubbleLedgerCoverage([
				{ start_ledger: 2, end_ledger: 100 }
			]),
			watermark: {
				mode: 'latest-ingested-observations' as const,
				catalogGeneratedAt: '2026-09-08T00:00:00Z',
				catalogMaximumLedger: '100',
				snapshotPinned: false as const
			}
		};
		warehouse.assetHolders
			.mockResolvedValueOnce(page)
			.mockResolvedValueOnce({ ...page, holders: [] })
			.mockRejectedValueOnce(
				new HubbleWarehouseUnavailableError('unavailable')
			);
		const app = express();
		app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse }));
		const url = '/v1/analytics/assets/native/holders/' + account;
		const found = await request(app).get(url).expect(200);
		expect(found.body.holder.balance).toBe(730.3194445);
		await request(app).get(url).expect(404);
		const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await request(app).get(url).expect(503);
		} finally {
			quiet.mockRestore();
		}
		expect(warehouse.assetHolders).toHaveBeenCalledTimes(3);
		expect(warehouse.query).not.toHaveBeenCalled();
	});
});
