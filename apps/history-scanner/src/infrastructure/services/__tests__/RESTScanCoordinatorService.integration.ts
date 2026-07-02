import { RESTScanCoordinatorService } from '../RESTScanCoordinatorService.js';
import { Url, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { Scan } from '../../../domain/scan/Scan.js';

describe('RESTScanCoordinatorService Integration Tests', () => {
	let httpService: jest.Mocked<HttpService>;
	let service: RESTScanCoordinatorService;
	const baseUrl = 'http://home.com';
	const username = 'admin';
	const secret = 'test-secret';

	beforeEach(() => {
		httpService = mock<HttpService>();
		service = new RESTScanCoordinatorService(
			httpService,
			baseUrl,
			username,
			secret
		);
	});

	describe('registerScan', () => {
		const url = Url.create('https://history.stellar.org');
		it('should successfully register scan result', async () => {
			const scan = new Scan(
				new Date(),
				new Date(),
				new Date(),
				url._unsafeUnwrap(),
				1,
				100,
				90,
				'hash123',
				5,
				false,
				null,
				'remote-id'
			);

			httpService.post.mockResolvedValue(
				ok({
					status: 201,
					statusText: 'Created',
					headers: {},
					data: { message: 'Scan created successfully' }
				})
			);

			const result = await service.registerScan(scan);
			expect(result.isOk()).toBe(true);

			expect(httpService.post).toHaveBeenCalledTimes(1);
		});
	});

	describe('getScanJobs', () => {
		it('should successfully get pending scan jobs', async () => {
			const initDate = new Date();
			const mockJob = {
				url: 'https://history.stellar.org',
				latestScannedLedger: 100,
				latestScannedLedgerHeaderHash: 'hash123',
				chainInitDate: initDate.toISOString(),
				remoteId: 'remote-id'
			};

			httpService.get.mockResolvedValue(
				ok({
					status: 200,
					data: mockJob,
					headers: {},
					statusText: 'OK'
				})
			);

			const result = await service.getScanJob();
			expect(result.isOk()).toBe(true);
			if (result.isOk()) {
				expect(result.value).toEqual({
					url: 'https://history.stellar.org',
					latestScannedLedger: 100,
					latestScannedLedgerHeaderHash: 'hash123',
					chainInitDate: initDate,
					remoteId: 'remote-id',
					fromLedger: null,
					toLedger: null,
					concurrency: null
				});
			}
		});
	});

	describe('touchScanJob', () => {
		it('should send a scan job heartbeat', async () => {
			httpService.post.mockResolvedValue(
				ok({
					status: 204,
					data: null,
					headers: {},
					statusText: 'No Content'
				})
			);

			const result = await service.touchScanJob(
				'82a309de-a5df-457b-9412-f267ed5e7388'
			);

			expect(result.isOk()).toBe(true);
			expect(httpService.post).toHaveBeenCalledWith(
				Url.create(
					`${baseUrl}/v1/history-scan/job/82a309de-a5df-457b-9412-f267ed5e7388/heartbeat`
				)._unsafeUnwrap(),
				{},
				{
					auth: {
						username,
						password: secret
					}
				}
			);
		});
	});
});
