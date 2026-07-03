import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { randomUUID } from 'crypto';
import {
	CommunityScannerRouterWrapper,
	type CommunityScannerRouterConfig
} from '../CommunityScannerRouter.js';
import {
	DuplicateCommunityScannerError,
	RegisterCommunityScanner
} from '@history-scan-coordinator/use-cases/RegisterCommunityScanner.js';
import {
	CommunityScannerBlacklistedError,
	CommunityScannerNotFoundError,
	InvalidCommunityScannerApiKeyError,
	SendScannerHeartbeat
} from '@history-scan-coordinator/use-cases/SendScannerHeartbeat.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { ScannerStatus } from '@history-scan-coordinator/infrastructure/database/entities/CommunityScanner.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import {
	RegisterScan,
	ScanJobNotActiveError,
	ScanJobNotFoundError,
	ScanJobOwnershipError
} from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';

describe('CommunityScannerRouter.integration', () => {
	let app: express.Application;
	let registerCommunityScanner: jest.Mocked<RegisterCommunityScanner>;
	let sendScannerHeartbeat: jest.Mocked<SendScannerHeartbeat>;
	let getScannerMetrics: jest.Mocked<GetScannerMetrics>;
	let getScanJob: jest.Mocked<GetScanJob>;
	let touchScanJob: jest.Mocked<TouchScanJob>;
	let registerScan: jest.Mocked<RegisterScan>;

	beforeEach(() => {
		registerCommunityScanner = mock<RegisterCommunityScanner>();
		sendScannerHeartbeat = mock<SendScannerHeartbeat>();
		getScannerMetrics = mock<GetScannerMetrics>();
		getScanJob = mock<GetScanJob>();
		touchScanJob = mock<TouchScanJob>();
		registerScan = mock<RegisterScan>();
		mountRouter();
	});

	describe('POST /register', () => {
		it('should register a scanner without exposing contact email or key hash', async () => {
			registerCommunityScanner.execute.mockResolvedValue(
				ok({
					id: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
					name: 'Archive Desk',
					description: 'remote worker',
					status: ScannerStatus.PENDING,
					apiKey: 'satlas_scanner_secret',
					createdAt: '2026-07-03T12:00:00.000Z'
				})
			);

			await request(app)
				.post('/community-scanners/register')
				.send({
					name: 'Archive Desk',
					description: 'remote worker',
					contactEmail: 'desk@example.com'
				})
				.expect(201)
				.expect((response) => {
					expect(response.body).toEqual({
						id: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
						name: 'Archive Desk',
						description: 'remote worker',
						status: ScannerStatus.PENDING,
						apiKey: 'satlas_scanner_secret',
						createdAt: '2026-07-03T12:00:00.000Z'
					});
					expect(response.body.contactEmail).toBeUndefined();
					expect(response.body.apiKeyHash).toBeUndefined();
				});
		});

		it('should reject invalid registration bodies', async () => {
			await request(app)
				.post('/community-scanners/register')
				.send({ name: '', contactEmail: 'not-an-email' })
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
			expect(registerCommunityScanner.execute).not.toHaveBeenCalled();
		});

		it('should return conflict for duplicate contact emails', async () => {
			registerCommunityScanner.execute.mockResolvedValue(
				err(new DuplicateCommunityScannerError())
			);

			await request(app)
				.post('/community-scanners/register')
				.send({ name: 'Archive Desk', contactEmail: 'desk@example.com' })
				.expect(409)
				.expect((response) => {
					expect(response.body).toEqual({
						error: 'Scanner with this email already exists'
					});
				});
		});
	});

	describe('POST /:id/heartbeat', () => {
		const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';

		it('should accept authenticated scanner heartbeats', async () => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				ok({
					id: scannerId,
					lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
					status: ScannerStatus.ONLINE
				})
			);

			await request(app)
				.post(`/community-scanners/${scannerId}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(200)
				.expect((response) => {
					expect(response.body).toEqual({
						id: scannerId,
						lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
						status: ScannerStatus.ONLINE
					});
				});
			expect(sendScannerHeartbeat.execute).toHaveBeenCalledWith({
				scannerId,
				apiKey: 'satlas_scanner_secret'
			});
		});

		it('should require bearer authentication', async () => {
			await request(app)
				.post(`/community-scanners/${scannerId}/heartbeat`)
				.expect(401)
				.expect((response) => {
					expect(response.body).toEqual({
						error: 'Invalid authorization format. Use: Bearer <api-key>'
					});
				});
			expect(sendScannerHeartbeat.execute).not.toHaveBeenCalled();
		});

		it('should map heartbeat auth and policy errors', async () => {
			sendScannerHeartbeat.execute
				.mockResolvedValueOnce(err(new CommunityScannerNotFoundError()))
				.mockResolvedValueOnce(err(new InvalidCommunityScannerApiKeyError()))
				.mockResolvedValueOnce(err(new CommunityScannerBlacklistedError()));

			await request(app)
				.post(`/community-scanners/${scannerId}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(404);
			await request(app)
				.post(`/community-scanners/${scannerId}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(401);
			await request(app)
				.post(`/community-scanners/${scannerId}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(403);
		});
	});

	describe('GET /:id/job', () => {
		const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';

		beforeEach(() => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				ok({
					id: scannerId,
					lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
					status: ScannerStatus.ONLINE
				})
			);
		});

		it('should return the next job for an authenticated scanner', async () => {
			const remoteId = randomUUID();
			getScanJob.execute.mockResolvedValue(
				ok({
					chainInitDate: new Date('2026-07-03T12:00:00.000Z'),
					url: 'https://archive.example.com',
					latestScannedLedger: 100,
					latestScannedLedgerHeaderHash: 'hash',
					remoteId,
					fromLedger: 1,
					toLedger: 100,
					concurrency: 12
				})
			);

			await request(app)
				.get(`/community-scanners/${scannerId}/job`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(200)
				.expect((response) => {
					expect(response.body).toMatchObject({
						url: 'https://archive.example.com',
						remoteId,
						concurrency: 12
					});
				});

			expect(getScanJob.execute).toHaveBeenCalledWith({
				communityScannerId: scannerId
			});
		});

		it('should return 204 when no scanner job is available', async () => {
			getScanJob.execute.mockResolvedValue(ok(null));

			await request(app)
				.get(`/community-scanners/${scannerId}/job`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(204);
		});

		it('should require bearer authentication', async () => {
			await request(app)
				.get(`/community-scanners/${scannerId}/job`)
				.expect(401);

			expect(getScanJob.execute).not.toHaveBeenCalled();
		});

		it('should not claim jobs for blocked scanners', async () => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				err(new CommunityScannerBlacklistedError())
			);

			await request(app)
				.get(`/community-scanners/${scannerId}/job`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(403);
			expect(getScanJob.execute).not.toHaveBeenCalled();
		});
	});

	describe('POST /:id/job/:remoteId/heartbeat', () => {
		const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';

		beforeEach(() => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				ok({
					id: scannerId,
					lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
					status: ScannerStatus.ONLINE
				})
			);
		});

		it('should refresh a scanner-owned taken job', async () => {
			const remoteId = randomUUID();
			touchScanJob.execute.mockResolvedValue(ok(true));

			await request(app)
				.post(`/community-scanners/${scannerId}/job/${remoteId}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(204);

			expect(touchScanJob.execute).toHaveBeenCalledWith(remoteId, {
				communityScannerId: scannerId
			});
		});

		it('should return 404 when the job is not owned and active', async () => {
			touchScanJob.execute.mockResolvedValue(ok(false));

			await request(app)
				.post(`/community-scanners/${scannerId}/job/${randomUUID()}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(404);
		});

		it('should not touch jobs for blocked scanners', async () => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				err(new CommunityScannerBlacklistedError())
			);

			await request(app)
				.post(`/community-scanners/${scannerId}/job/${randomUUID()}/heartbeat`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.expect(403);
			expect(touchScanJob.execute).not.toHaveBeenCalled();
		});
	});

	describe('POST /:id/scans', () => {
		const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';

		beforeEach(() => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				ok({
					id: scannerId,
					lastHeartbeatAt: '2026-07-03T12:00:00.000Z',
					status: ScannerStatus.ONLINE
				})
			);
		});

		it('should register a scanner-attributed scan result', async () => {
			const body = createValidScanBody(randomUUID());
			registerScan.execute.mockResolvedValue(ok(undefined));

			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(body)
				.expect(201)
				.expect((response) => {
					expect(response.body).toEqual({
						message: 'Scan created successfully'
					});
				});

			expect(registerScan.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					baseUrl: body.baseUrl,
					scanJobRemoteId: body.scanJobRemoteId
				}),
				{ communityScannerId: scannerId }
			);
		});

		it('should revalidate frontend cache tags after scan results', async () => {
			const originalFetch = global.fetch;
			const fetchMock = jest.fn().mockResolvedValue({}) as jest.Mock;
			global.fetch = fetchMock as unknown as typeof fetch;
			mountRouter({
				frontendBaseUrl: 'https://frontend.example.com',
				frontendRevalidateToken: 'revalidate-secret'
			});

			try {
				registerScan.execute.mockResolvedValue(ok(undefined));

				await request(app)
					.post(`/community-scanners/${scannerId}/scans`)
					.set('Authorization', 'Bearer satlas_scanner_secret')
					.send(createValidScanBody(randomUUID()))
					.expect(201);

				expect(fetchMock).toHaveBeenCalledTimes(1);
				const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
				expect(url.toString()).toBe(
					'https://frontend.example.com/api/revalidate'
				);
				expect(init.method).toBe('POST');
				expect(init.headers).toEqual({
					authorization: 'Bearer revalidate-secret',
					'content-type': 'application/json'
				});
				expect(init.body).toBe(
					JSON.stringify({ tags: ['history-scan', 'network'] })
				);
				expect(init.signal).toBeDefined();
			} finally {
				global.fetch = originalFetch;
			}
		});

		it('should reject non-UUID scan job ids for scanner submissions', async () => {
			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(createValidScanBody('not-a-uuid'))
				.expect(400);

			expect(registerScan.execute).not.toHaveBeenCalled();
		});

		it('should map scanner job registration policy errors', async () => {
			registerScan.execute
				.mockResolvedValueOnce(err(new ScanJobNotFoundError()))
				.mockResolvedValueOnce(err(new ScanJobOwnershipError()))
				.mockResolvedValueOnce(err(new ScanJobNotActiveError()));

			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(createValidScanBody(randomUUID()))
				.expect(404);
			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(createValidScanBody(randomUUID()))
				.expect(403);
			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(createValidScanBody(randomUUID()))
				.expect(409);
		});

		it('should not submit results for blocked scanners', async () => {
			sendScannerHeartbeat.execute.mockResolvedValue(
				err(new CommunityScannerBlacklistedError())
			);

			await request(app)
				.post(`/community-scanners/${scannerId}/scans`)
				.set('Authorization', 'Bearer satlas_scanner_secret')
				.send(createValidScanBody(randomUUID()))
				.expect(403);
			expect(registerScan.execute).not.toHaveBeenCalled();
		});
	});

	describe('GET /metrics', () => {
		it('should expose safe scanner metrics with a short public cache age', async () => {
			getScannerMetrics.execute.mockResolvedValue(
				ok({
					generatedAt: '2026-07-03T12:00:00.000Z',
					heartbeatFreshnessMs: 300000,
					totalScanners: 3,
					activeScanners: 2,
					offlineScanners: 1,
					degradedScanners: 0,
					pendingScanners: 1,
					blacklistedScanners: 0,
					averageSuccessRate: 90,
					totalJobsCompleted: 10,
					totalJobsFailed: 1,
					averageCompletionTimeMs: 12000
				})
			);

			await request(app)
				.get('/community-scanners/metrics')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toMatchObject({
						totalScanners: 3,
						activeScanners: 2,
						offlineScanners: 1
					});
					expect(response.body.contactEmail).toBeUndefined();
					expect(response.body.apiKey).toBeUndefined();
					expect(response.body.apiKeyHash).toBeUndefined();
				});
		});
	});

	function mountRouter(overrides: Partial<CommunityScannerRouterConfig> = {}) {
		app = express();
		app.use(express.json());
		app.use(
			'/community-scanners',
			CommunityScannerRouterWrapper({
				registerCommunityScanner,
				sendScannerHeartbeat,
				getScannerMetrics,
				getScanJob,
				touchScanJob,
				registerScan,
				...overrides
			})
		);
	}
});

function createValidScanBody(scanJobRemoteId: string) {
	return {
		startDate: '2026-07-03T12:00:00.000Z',
		endDate: '2026-07-03T12:00:05.000Z',
		baseUrl: 'https://archive.example.com',
		scanChainInitDate: '2026-07-03T12:00:00.000Z',
		latestVerifiedLedger: 100,
		latestScannedLedger: 100,
		latestScannedLedgerHeaderHash: null,
		concurrency: 5,
		isSlowArchive: false,
		fromLedger: 0,
		toLedger: null,
		error: null,
		errors: [],
		scanJobRemoteId
	};
}
