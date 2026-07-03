import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { ArchiveScanRouterWrapper } from '../ArchiveScanRouter.js';
import { GetArchiveScans } from '@history-scan-coordinator/use-cases/get-archive-scans/GetArchiveScans.js';
import { GetArchiveScanQueue } from '@history-scan-coordinator/use-cases/get-archive-scan-queue/GetArchiveScanQueue.js';
import { GetArchiveScanWorkers } from '@history-scan-coordinator/use-cases/get-archive-scan-workers/GetArchiveScanWorkers.js';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';
import { InvalidUrlError } from '@history-scan-coordinator/use-cases/get-latest-scan/InvalidUrlError.js';
import { HistoryArchiveScan } from 'shared';
import type { HistoryArchiveScanLogEntryDTO } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';

describe('ArchiveScanRouter.integration', () => {
	let app: express.Application;
	let getArchiveScans: jest.Mocked<GetArchiveScans>;
	let getArchiveScanQueue: jest.Mocked<GetArchiveScanQueue>;
	let getArchiveScanWorkers: jest.Mocked<GetArchiveScanWorkers>;
	let getLatestScan: jest.Mocked<GetLatestScan>;
	let getScanLogs: jest.Mocked<GetScanLogs>;

	beforeEach(() => {
		getArchiveScans = mock<GetArchiveScans>();
		getArchiveScanQueue = mock<GetArchiveScanQueue>();
		getArchiveScanWorkers = mock<GetArchiveScanWorkers>();
		getLatestScan = mock<GetLatestScan>();
		getScanLogs = mock<GetScanLogs>();
		app = express();
		app.use(express.json());
		app.use(
			'/archive-scans',
			ArchiveScanRouterWrapper({
				getArchiveScans,
				getArchiveScanQueue,
				getArchiveScanWorkers,
				getLatestScan,
				getScanLogs
			})
		);
	});

	describe('GET /', () => {
		it('should expose a bounded archive scan list', async () => {
			getArchiveScans.execute.mockResolvedValue(
				ok({
					generatedAt: '2026-07-03T12:00:00.000Z',
					limit: 2,
					count: 1,
					scans: [
						new HistoryArchiveScan(
							'https://history.example.com',
							new Date('2026-07-03T10:00:00.000Z'),
							new Date('2026-07-03T10:05:00.000Z'),
							100,
							false,
							null,
							null,
							false
						)
					]
				})
			);

			await request(app)
				.get('/archive-scans?limit=2')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toMatchObject({
						generatedAt: '2026-07-03T12:00:00.000Z',
						limit: 2,
						count: 1
					});
					expect(response.body.scans).toHaveLength(1);
					expect(response.body.scans[0]).toMatchObject({
						url: 'https://history.example.com',
						latestVerifiedLedger: 100
					});
				});

			expect(getArchiveScans.execute).toHaveBeenCalledWith({ limit: 2 });
			expect(getLatestScan.execute).not.toHaveBeenCalled();
			expect(getScanLogs.execute).not.toHaveBeenCalled();
		});

		it('should return 400 for invalid limits', async () => {
			await request(app)
				.get('/archive-scans?limit=500')
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
			expect(getArchiveScans.execute).not.toHaveBeenCalled();
		});

		it('should return 500 when archive scan listing fails', async () => {
			getArchiveScans.execute.mockResolvedValue(
				err(new Error('database unavailable'))
			);

			await request(app)
				.get('/archive-scans')
				.expect(500)
				.expect((response) => {
					expect(response.body).toEqual({ error: 'Internal server error' });
				});
		});
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
			expect(getLatestScan.execute).not.toHaveBeenCalled();
			expect(getScanLogs.execute).not.toHaveBeenCalled();
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

	describe('GET /workers', () => {
		it('should expose active and stale worker slots without hitting URL routes', async () => {
			getArchiveScanWorkers.execute.mockResolvedValue(
				ok({
					generatedAt: '2026-07-03T12:00:00.000Z',
					staleJobAgeMs: 1800000,
					activeWorkers: 1,
					staleWorkers: 1,
					totalTakenJobs: 2,
					workers: [
						{
							archiveUrl: 'https://stale.example',
							status: 'stale',
							claimedAt: '2026-07-03T10:00:00.000Z',
							lastHeartbeatAt: '2026-07-03T11:00:00.000Z',
							heartbeatAgeMs: 3600000,
							fromLedger: 0,
							toLedger: null,
							latestScannedLedger: 0,
							concurrency: 2
						}
					]
				})
			);

			await request(app)
				.get('/archive-scans/workers')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toMatchObject({
						activeWorkers: 1,
						staleWorkers: 1,
						totalTakenJobs: 2
					});
					expect(response.body.workers).toHaveLength(1);
					expect(response.body.workers[0]).toMatchObject({
						archiveUrl: 'https://stale.example',
						status: 'stale'
					});
				});

			expect(getArchiveScanWorkers.execute).toHaveBeenCalledTimes(1);
			expect(getLatestScan.execute).not.toHaveBeenCalled();
			expect(getScanLogs.execute).not.toHaveBeenCalled();
		});

		it('should return 500 when worker metadata fails', async () => {
			getArchiveScanWorkers.execute.mockResolvedValue(
				err(new Error('database unavailable'))
			);

			await request(app)
				.get('/archive-scans/workers')
				.expect(500)
				.expect((response) => {
					expect(response.body).toEqual({ error: 'Internal server error' });
				});
		});
	});

	describe('GET /:encodedUrl', () => {
		it('should return 400 for invalid URLs', async () => {
			await request(app)
				.get('/archive-scans/not-a-url')
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
		});

		it('should return 400 when the use case rejects the URL', async () => {
			getLatestScan.execute.mockResolvedValue(
				err(new InvalidUrlError('https://test.com'))
			);

			await request(app)
				.get('/archive-scans/https%3A%2F%2Ftest.com')
				.expect(400)
				.expect((response) => {
					expect(response.body).toEqual({ error: 'Invalid url' });
				});
		});

		it('should expose the latest archive scan', async () => {
			const scan = new HistoryArchiveScan(
				'https://test.com',
				new Date('2026-07-03T10:00:00.000Z'),
				new Date('2026-07-03T10:05:00.000Z'),
				100,
				false,
				null,
				null,
				false
			);
			getLatestScan.execute.mockResolvedValue(ok(scan));

			await request(app)
				.get('/archive-scans/https%3A%2F%2Ftest.com')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toMatchObject({
						url: 'https://test.com',
						latestVerifiedLedger: 100,
						hasError: false
					});
				});

			expect(getLatestScan.execute).toHaveBeenCalledWith({
				url: 'https://test.com'
			});
		});

		it('should return 204 when no scan exists for the URL', async () => {
			getLatestScan.execute.mockResolvedValue(ok(null));

			await request(app)
				.get('/archive-scans/https%3A%2F%2Ftest.com')
				.expect(204)
				.expect('Cache-Control', 'public, max-age=10');
		});
	});

	describe('GET /:encodedUrl/errors', () => {
		it('should return 400 for invalid URLs', async () => {
			await request(app)
				.get('/archive-scans/not-a-url/errors')
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
		});

		it('should expose archive scan log entries', async () => {
			const logEntry: HistoryArchiveScanLogEntryDTO = {
				concurrency: 1,
				durationMs: 100,
				endDate: new Date('2026-07-03T10:05:00.000Z'),
				errors: [],
				fromLedger: 0,
				hasArchiveVerificationError: false,
				hasError: false,
				hasWorkerIssue: false,
				isSlowArchive: false,
				latestScannedLedger: 100,
				latestVerifiedLedger: 100,
				startDate: new Date('2026-07-03T10:00:00.000Z'),
				status: 'completed',
				toLedger: 100,
				updatedAt: new Date('2026-07-03T10:05:00.000Z'),
				url: 'https://test.com'
			};
			getScanLogs.execute.mockResolvedValue(ok([logEntry]));

			await request(app)
				.get('/archive-scans/https%3A%2F%2Ftest.com/errors')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toHaveLength(1);
					expect(response.body[0]).toMatchObject({
						url: 'https://test.com',
						status: 'completed',
						hasArchiveVerificationError: false,
						hasWorkerIssue: false
					});
				});

			expect(getScanLogs.execute).toHaveBeenCalledWith('https://test.com');
			expect(getLatestScan.execute).not.toHaveBeenCalled();
		});

		it('should return 500 when archive scan logs fail', async () => {
			getScanLogs.execute.mockResolvedValue(
				err(new Error('database unavailable'))
			);

			await request(app)
				.get('/archive-scans/https%3A%2F%2Ftest.com/errors')
				.expect(500)
				.expect((response) => {
					expect(response.body).toEqual({ error: 'Internal server error' });
				});
		});
	});
});
