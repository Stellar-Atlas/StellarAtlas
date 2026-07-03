import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { CommunityScannerRouterWrapper } from '../CommunityScannerRouter.js';
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

describe('CommunityScannerRouter.integration', () => {
	let app: express.Application;
	let registerCommunityScanner: jest.Mocked<RegisterCommunityScanner>;
	let sendScannerHeartbeat: jest.Mocked<SendScannerHeartbeat>;
	let getScannerMetrics: jest.Mocked<GetScannerMetrics>;

	beforeEach(() => {
		registerCommunityScanner = mock<RegisterCommunityScanner>();
		sendScannerHeartbeat = mock<SendScannerHeartbeat>();
		getScannerMetrics = mock<GetScannerMetrics>();
		app = express();
		app.use(express.json());
		app.use(
			'/community-scanners',
			CommunityScannerRouterWrapper({
				registerCommunityScanner,
				sendScannerHeartbeat,
				getScannerMetrics
			})
		);
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
});
