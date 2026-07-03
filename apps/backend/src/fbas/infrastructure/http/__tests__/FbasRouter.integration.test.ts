import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import {
	FbasAnalysisValidationError,
	GetFbasAnalysis
} from '@fbas/use-cases/get-fbas-analysis/GetFbasAnalysis.js';
import { GetLatestFbas } from '@fbas/use-cases/get-latest-fbas/GetLatestFbas.js';
import {
	FbasTopTierHistoryValidationError,
	GetTopTierHistory
} from '@fbas/use-cases/get-top-tier-history/GetTopTierHistory.js';
import { FbasRouterWrapper } from '../FbasRouter.js';

describe('FbasRouter.integration', () => {
	let app: express.Application;
	let getFbasAnalysis: jest.Mocked<GetFbasAnalysis>;
	let getLatestFbas: jest.Mocked<GetLatestFbas>;
	let getTopTierHistory: jest.Mocked<GetTopTierHistory>;

	beforeEach(() => {
		getFbasAnalysis = mock<GetFbasAnalysis>();
		getLatestFbas = mock<GetLatestFbas>();
		getTopTierHistory = mock<GetTopTierHistory>();
		app = express();
		app.use(
			'/fbas',
			FbasRouterWrapper({
				getFbasAnalysis,
				getLatestFbas,
				getTopTierHistory
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

	it('should expose aggregate FBAS evidence for a completed scan', async () => {
		getFbasAnalysis.execute.mockResolvedValue(
			ok({
				generatedAt: '2026-07-03T12:00:00.000Z',
				evidenceSelection: 'completed_network_scan_measurement',
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
			.get('/fbas/analyses/42')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.scanId).toBe(42);
				expect(response.body.evidenceSelection).toBe(
					'completed_network_scan_measurement'
				);
				expect(response.body.proofSetPersistence).toBe('not_persisted');
			});
		expect(getFbasAnalysis.execute).toHaveBeenCalledWith({ scanId: 42 });
	});

	it('should reject invalid analysis scan ids', async () => {
		await request(app)
			.get('/fbas/analyses/not-a-scan')
			.expect(400)
			.expect((response) => {
				expect(response.body.errors).toHaveLength(1);
			});
		expect(getFbasAnalysis.execute).not.toHaveBeenCalled();
	});

	it('should expose aggregate top-tier history from persisted rollups', async () => {
		getTopTierHistory.execute.mockResolvedValue(
			ok({
				dayCount: 1,
				evidenceSelection: 'network_measurement_day_rollups',
				from: '2026-07-01',
				generatedAt: '2026-07-03T12:00:00.000Z',
				maxWindowDays: 90,
				points: [
					{
						crawlCount: 4,
						day: '2026-07-01',
						hasData: true,
						hasQuorumIntersectionCount: 3,
						hasSymmetricTopTierCount: 2,
						hasTransitiveQuorumSetCount: 4,
						topTier: {
							average: 10,
							max: 12,
							min: 8
						},
						topTierOrganizations: {
							average: 4,
							max: 5,
							min: 3
						}
					}
				],
				proofSetPersistence: 'not_persisted',
				to: '2026-07-01'
			})
		);

		await request(app)
			.get('/fbas/top-tier/history?from=2026-07-01&to=2026-07-01')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.proofSetPersistence).toBe('not_persisted');
				expect(response.body.points[0].topTier.average).toBe(10);
				expect(response.body.points[0].topTierOrganizations.max).toBe(5);
			});
		expect(getTopTierHistory.execute).toHaveBeenCalledWith({
			from: new Date('2026-07-01T00:00:00.000Z'),
			to: new Date('2026-07-01T00:00:00.000Z')
		});
	});

	it('should reject invalid top-tier history date queries', async () => {
		await request(app)
			.get('/fbas/top-tier/history?from=not-a-date&to=2026-07-01')
			.expect(400)
			.expect((response) => {
				expect(response.body.errors).toHaveLength(1);
			});
		expect(getTopTierHistory.execute).not.toHaveBeenCalled();
	});

	it('should map top-tier history validation failures to bad requests', async () => {
		getTopTierHistory.execute.mockResolvedValue(
			err(
				new FbasTopTierHistoryValidationError(
					'FBAS top-tier history window cannot exceed 90 days'
				)
			)
		);

		await request(app)
			.get('/fbas/top-tier/history?from=2026-01-01&to=2026-04-02')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'FBAS top-tier history window cannot exceed 90 days'
				});
			});
	});

	it('should return not found when a requested FBAS analysis does not exist', async () => {
		getFbasAnalysis.execute.mockResolvedValue(ok(null));

		await request(app)
			.get('/fbas/analyses/42')
			.expect(404)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'FBAS analysis not found'
				});
			});
	});

	it('should map FBAS analysis validation failures to bad requests', async () => {
		getFbasAnalysis.execute.mockResolvedValue(
			err(
				new FbasAnalysisValidationError(
					'scanId must be a positive 32-bit integer'
				)
			)
		);

		await request(app)
			.get('/fbas/analyses/42')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'scanId must be a positive 32-bit integer'
				});
			});
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

	it('should map FBAS analysis use-case failures to server errors', async () => {
		getFbasAnalysis.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/fbas/analyses/42')
			.expect(500)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});

	it('should map top-tier history use-case failures to server errors', async () => {
		getTopTierHistory.execute.mockResolvedValue(err(new Error('boom')));

		await request(app)
			.get('/fbas/top-tier/history?from=2026-07-01&to=2026-07-01')
			.expect(500)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
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
