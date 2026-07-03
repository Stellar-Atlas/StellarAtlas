import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import { FbasRouterWrapper } from '../FbasRouter.js';

describe('FbasRouter.integration', () => {
	let app: express.Application;
	let getLatestFbas: jest.Mocked<GetLatestFbas>;

	beforeEach(() => {
		getLatestFbas = mock<GetLatestFbas>();
		app = express();
		app.use(
			'/fbas',
			FbasRouterWrapper({
				getLatestFbas
			})
		);
	});

	it('should expose latest aggregate FBAS evidence', async () => {
		getLatestFbas.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				evidenceSelection: 'latest_completed_network_scan_measurement',
				proofSetPersistence: 'not_persisted',
				scanId: 42,
				scanTime: '2026-07-03T11:56:00.000Z',
				latestLedger: '123456789',
				latestLedgerCloseTime: '2026-07-03T11:55:00.000Z',
				processedLedgers: [123456000, 123456789],
				summary: {
					nrOfActiveWatchers: 4,
					nrOfConnectableNodes: 8,
					nrOfActiveValidators: 7,
					nrOfActiveFullValidators: 6,
					nrOfActiveOrganizations: 5,
					transitiveQuorumSetSize: 9,
					hasTransitiveQuorumSet: true,
					topTierSize: 10,
					topTierOrgsSize: 3,
					hasSymmetricTopTier: true,
					hasQuorumIntersection: true,
					minBlockingSetSize: 2,
					minBlockingSetFilteredSize: 3,
					minBlockingSetOrgsSize: 4,
					minBlockingSetOrgsFilteredSize: 5,
					minBlockingSetCountrySize: 6,
					minBlockingSetCountryFilteredSize: 7,
					minBlockingSetISPSize: 8,
					minBlockingSetISPFilteredSize: 9,
					minSplittingSetSize: 11,
					minSplittingSetOrgsSize: 12,
					minSplittingSetCountrySize: 13,
					minSplittingSetISPSize: 14
				}
			})
		);

		await request(app)
			.get('/fbas/latest')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.scanId).toBe(42);
				expect(response.body.proofSetPersistence).toBe('not_persisted');
				expect(response.body.summary.hasQuorumIntersection).toBe(true);
			});
		expect(getLatestFbas.execute).toHaveBeenCalledTimes(1);
	});

	it('should return not found when no latest FBAS analysis exists', async () => {
		getLatestFbas.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/fbas/latest')
			.expect(404)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Latest FBAS analysis not found'
				});
			});
	});

	it('should map use-case failures to server errors', async () => {
		getLatestFbas.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/fbas/latest')
			.expect(500)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});
