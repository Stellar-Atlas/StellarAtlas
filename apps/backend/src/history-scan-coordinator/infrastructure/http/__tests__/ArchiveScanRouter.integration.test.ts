import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { ArchiveScanRouterWrapper } from '../ArchiveScanRouter.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';

describe('ArchiveScanRouter.integration', () => {
	let app: express.Application;
	let getArchiveScanQueue: jest.Mocked<GetArchiveScanQueue>;

	beforeEach(() => {
		getArchiveScanQueue = mock<GetArchiveScanQueue>();
		app = express();
		app.use(express.json());
		app.use(
			'/archive-scans',
			ArchiveScanRouterWrapper({
				getArchiveScanQueue
			})
		);
	});

	describe('GET /queue', () => {
		it('should expose queue stats with frontend-aligned cache age', async () => {
			getArchiveScanQueue.execute.mockResolvedValue(
				ok({
					pendingJobs: 3,
					activeJobs: 2,
					staleJobs: 1,
					totalUnfinishedJobs: 6,
					generatedAt: '2026-07-03T12:00:00.000Z',
					staleJobAgeMs: 1800000
				})
			);

			await request(app)
				.get('/archive-scans/queue')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toEqual({
						pendingJobs: 3,
						activeJobs: 2,
						staleJobs: 1,
						totalUnfinishedJobs: 6,
						generatedAt: '2026-07-03T12:00:00.000Z',
						staleJobAgeMs: 1800000
					});
				});
		});

		it('should return 500 when queue stats fail', async () => {
			getArchiveScanQueue.execute.mockResolvedValue(
				err(new Error('database unavailable'))
			);

			await request(app)
				.get('/archive-scans/queue')
				.expect(500)
				.expect((response) => {
					expect(response.body).toEqual({ error: 'Internal server error' });
				});
		});
	});
});
