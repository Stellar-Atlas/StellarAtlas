import { RESTScanCoordinatorService } from '../RESTScanCoordinatorService.js';
import { Url, type HttpService } from 'http-helper';
import { mock } from 'jest-mock-extended';
import { ok } from 'neverthrow';
import { Scan } from '@domain/scan/Scan.js';
import { ScanError, ScanErrorType } from '@domain/scan/ScanError.js';
import { ParsedLedgerHeaderBatchDTO } from 'history-scanner-dto';

describe('RESTScanCoordinatorService Integration Tests', () => {
	let httpService: jest.Mocked<HttpService>;
	let service: RESTScanCoordinatorService;
	const baseUrl = 'http://home.com';
	const username = 'admin';
	const secret = 'test-secret';

	beforeEach(() => {
		httpService = mock<HttpService>();
		service = new RESTScanCoordinatorService(httpService, baseUrl, {
			type: 'internal',
			username,
			password: secret
		});
	});

	describe('registerScan', () => {
		const url = Url.create('https://history.stellar.org');
		it('should successfully register scan result', async () => {
			const scanError = new ScanError(
				ScanErrorType.TYPE_VERIFICATION,
				'https://history.stellar.org/transactions/00/00/00/transactions-0000003f.xdr.gz',
				'Wrong transaction hash'
			);
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
				scanError,
				[scanError],
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
			expect(httpService.post.mock.calls[0][1]).toMatchObject({
				error: {
					type: 'TYPE_VERIFICATION',
					url: scanError.url,
					message: scanError.message
				},
				errors: [
					{
						type: 'TYPE_VERIFICATION',
						url: scanError.url,
						message: scanError.message
					}
				],
				scanJobRemoteId: 'remote-id'
			});
		});

		it('should register scan results as a community scanner', async () => {
			const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';
			const apiKey = 'satlas_scanner_secret';
			const communityService = new RESTScanCoordinatorService(
				httpService,
				baseUrl,
				{
					type: 'community',
					scannerId,
					apiKey
				}
			);
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
				[],
				'82a309de-a5df-457b-9412-f267ed5e7388'
			);

			httpService.post.mockResolvedValue(
				ok({
					status: 201,
					statusText: 'Created',
					headers: {},
					data: { message: 'Scan created successfully' }
				})
			);

			const result = await communityService.registerScan(scan);

			expect(result.isOk()).toBe(true);
			expect(httpService.post).toHaveBeenCalledWith(
				Url.create(
					`${baseUrl}/v1/community-scanners/${scannerId}/scans`
				)._unsafeUnwrap(),
				expect.objectContaining({
					scanJobRemoteId: '82a309de-a5df-457b-9412-f267ed5e7388'
				}),
				{
					headers: {
						Authorization: `Bearer ${apiKey}`
					}
				}
			);
		});
	});

	describe('registerParsedLedgerHeaders', () => {
		it('should post parsed ledger headers for internal scanners', async () => {
			const batch = new ParsedLedgerHeaderBatchDTO(
				'https://history.stellar.org',
				'remote-id',
				new Date('2026-07-05T01:42:51.000Z'),
				[
					{
						bucketListHash: 'bucket-list-hash',
						ledgerHeaderHash: 'ledger-header-hash',
						ledgerSequence: 63332922,
						previousLedgerHeaderHash: 'previous-ledger-header-hash',
						protocolVersion: 23,
						transactionResultHash: 'transaction-result-hash',
						transactionSetHash: 'transaction-set-hash'
					}
				]
			);
			httpService.post.mockResolvedValue(
				ok({
					status: 201,
					statusText: 'Created',
					headers: {},
					data: { message: 'Parsed ledger headers registered' }
				})
			);

			const result = await service.registerParsedLedgerHeaders(batch);

			expect(result.isOk()).toBe(true);
			expect(httpService.post).toHaveBeenCalledWith(
				Url.create(
					`${baseUrl}/v1/history-scan/parsed-ledger-headers`
				)._unsafeUnwrap(),
				batch as unknown as Record<string, unknown>,
				{
					auth: {
						username,
						password: secret
					}
				}
			);
		});

		it('should not post parsed ledger headers for community scanners', async () => {
			const communityService = new RESTScanCoordinatorService(
				httpService,
				baseUrl,
				{
					type: 'community',
					scannerId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
					apiKey: 'satlas_scanner_secret'
				}
			);
			const result = await communityService.registerParsedLedgerHeaders(
				new ParsedLedgerHeaderBatchDTO(
					'https://history.stellar.org',
					'remote-id',
					new Date('2026-07-05T01:42:51.000Z'),
					[]
				)
			);

			expect(result.isOk()).toBe(true);
			expect(httpService.post).not.toHaveBeenCalled();
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

		it('should return null when no internal scan jobs are available', async () => {
			httpService.get.mockResolvedValue(
				ok({
					status: 204,
					data: null,
					headers: {},
					statusText: 'No Content'
				})
			);

			const result = await service.getScanJob();

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeNull();
		});

		it('should get pending scan jobs as a community scanner', async () => {
			const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';
			const apiKey = 'satlas_scanner_secret';
			const communityService = new RESTScanCoordinatorService(
				httpService,
				baseUrl,
				{
					type: 'community',
					scannerId,
					apiKey
				}
			);
			httpService.get.mockResolvedValue(
				ok({
					status: 200,
					data: {
						url: 'https://history.stellar.org',
						latestScannedLedger: 100,
						latestScannedLedgerHeaderHash: 'hash123',
						chainInitDate: new Date().toISOString(),
						remoteId: '82a309de-a5df-457b-9412-f267ed5e7388'
					},
					headers: {},
					statusText: 'OK'
				})
			);

			const result = await communityService.getScanJob();

			expect(result.isOk()).toBe(true);
			expect(httpService.get).toHaveBeenCalledWith(
				Url.create(
					`${baseUrl}/v1/community-scanners/${scannerId}/job`
				)._unsafeUnwrap(),
				{
					responseType: 'json',
					headers: {
						Authorization: `Bearer ${apiKey}`
					}
				}
			);
		});

		it('should return null when no community scan jobs are available', async () => {
			const communityService = new RESTScanCoordinatorService(
				httpService,
				baseUrl,
				{
					type: 'community',
					scannerId: '164f7788-9edb-4bb5-81c1-b928d85a21a5',
					apiKey: 'satlas_scanner_secret'
				}
			);
			httpService.get.mockResolvedValue(
				ok({
					status: 204,
					data: null,
					headers: {},
					statusText: 'No Content'
				})
			);

			const result = await communityService.getScanJob();

			expect(result.isOk()).toBe(true);
			expect(result._unsafeUnwrap()).toBeNull();
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

		it('should touch a scan job as a community scanner', async () => {
			const scannerId = '164f7788-9edb-4bb5-81c1-b928d85a21a5';
			const apiKey = 'satlas_scanner_secret';
			const remoteId = '82a309de-a5df-457b-9412-f267ed5e7388';
			const communityService = new RESTScanCoordinatorService(
				httpService,
				baseUrl,
				{
					type: 'community',
					scannerId,
					apiKey
				}
			);
			httpService.post.mockResolvedValue(
				ok({
					status: 204,
					data: null,
					headers: {},
					statusText: 'No Content'
				})
			);

			const result = await communityService.touchScanJob(remoteId);

			expect(result.isOk()).toBe(true);
			expect(httpService.post).toHaveBeenCalledWith(
				Url.create(
					`${baseUrl}/v1/community-scanners/${scannerId}/job/${remoteId}/heartbeat`
				)._unsafeUnwrap(),
				{},
				{
					headers: {
						Authorization: `Bearer ${apiKey}`
					}
				}
			);
		});
	});
});
