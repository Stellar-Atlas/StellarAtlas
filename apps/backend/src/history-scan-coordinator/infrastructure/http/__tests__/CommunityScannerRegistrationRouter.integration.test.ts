import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import {
	CommunityScannerRouterWrapper,
	type CommunityScannerRouterConfig
} from '../CommunityScannerRouter.js';
import {
	CommunityScannerRegistrationRateLimitError,
	RegisterCommunityScanner
} from '@history-scan-coordinator/use-cases/RegisterCommunityScanner.js';
import { SendScannerHeartbeat } from '@history-scan-coordinator/use-cases/SendScannerHeartbeat.js';
import { GetScannerMetrics } from '@history-scan-coordinator/use-cases/GetScannerMetrics.js';
import { ScannerStatus } from '@history-scan-coordinator/infrastructure/database/entities/CommunityScanner.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';

describe('CommunityScannerRegistrationRouter.integration', () => {
	let app: express.Application;
	let registerCommunityScanner: jest.Mocked<RegisterCommunityScanner>;

	beforeEach(() => {
		registerCommunityScanner = mock<RegisterCommunityScanner>();
		const config = createRouterConfig(registerCommunityScanner);
		app = express();
		app.set('trust proxy', true);
		app.use(express.json());
		app.use('/community-scanners', CommunityScannerRouterWrapper(config));
	});

	it('should pass the trusted registration source to the use case', async () => {
		registerCommunityScanner.execute.mockResolvedValue(
			ok({
				id: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
				name: 'Archive Desk',
				description: null,
				status: ScannerStatus.PENDING,
				apiKey: 'satlas_scanner_secret',
				createdAt: '2026-07-03T12:00:00.000Z'
			})
		);

		await request(app)
			.post('/community-scanners/register')
			.set('X-Forwarded-For', '198.51.100.44')
			.send({ name: 'Archive Desk', contactEmail: 'desk@example.com' })
			.expect(201);

		expect(registerCommunityScanner.execute).toHaveBeenCalledWith({
			name: 'Archive Desk',
			description: undefined,
			contactEmail: 'desk@example.com',
			registrationSource: '198.51.100.44'
		});
	});

	it('should return retry guidance for throttled registrations', async () => {
		registerCommunityScanner.execute.mockResolvedValue(
			err(new CommunityScannerRegistrationRateLimitError(1800))
		);

		await request(app)
			.post('/community-scanners/register')
			.set('X-Forwarded-For', '198.51.100.44')
			.send({ name: 'Archive Desk', contactEmail: 'desk@example.com' })
			.expect(429)
			.expect('Retry-After', '1800')
			.expect((response) => {
				expect(response.body).toEqual({
					error: 'Too many scanner registration attempts'
				});
				expect(response.body.contactEmail).toBeUndefined();
				expect(response.body.apiKey).toBeUndefined();
			});
	});

	function createRouterConfig(
		registerScanner: RegisterCommunityScanner
	): CommunityScannerRouterConfig {
		return {
			registerCommunityScanner: registerScanner,
			sendScannerHeartbeat: mock<SendScannerHeartbeat>(),
			getScannerMetrics: mock<GetScannerMetrics>(),
			getScanJob: mock<GetScanJob>(),
			touchScanJob: mock<TouchScanJob>(),
			registerScan: mock<RegisterScan>()
		};
	}
});
