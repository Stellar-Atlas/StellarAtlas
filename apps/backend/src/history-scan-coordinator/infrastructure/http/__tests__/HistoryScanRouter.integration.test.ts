import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { ok, err } from 'neverthrow';
import { HistoryScanRouterWrapper } from '../HistoryScanRouter.js';
import { Url } from 'http-helper';
import { GetLatestScan } from '@history-scan-coordinator/use-cases/get-latest-scan/GetLatestScan.js';
import { RegisterScan } from '@history-scan-coordinator/use-cases/register-scan/RegisterScan.js';
import { InvalidUrlError } from '@history-scan-coordinator/use-cases/get-latest-scan/InvalidUrlError.js';
import { ScanDTO } from 'history-scanner-dto';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { GetScanJob } from '@history-scan-coordinator/use-cases/get-scan-job/GetScanJob.js';
import { ReleaseScanJob } from '@history-scan-coordinator/use-cases/release-scan-job/ReleaseScanJob.js';
import { TouchScanJob } from '@history-scan-coordinator/use-cases/touch-scan-job/TouchScanJob.js';
import { GetScanLogs } from '@history-scan-coordinator/use-cases/get-scan-logs/GetScanLogs.js';
import { RegisterParsedLedgerHeaders } from '@history-scan-coordinator/use-cases/register-parsed-ledger-headers/RegisterParsedLedgerHeaders.js';
import { RegisterParsedTransactionEnvelopes } from '@history-scan-coordinator/use-cases/register-parsed-transaction-envelopes/RegisterParsedTransactionEnvelopes.js';
import { RegisterParsedTransactionResults } from '@history-scan-coordinator/use-cases/register-parsed-transaction-results/RegisterParsedTransactionResults.js';
import { randomUUID } from 'crypto';

describe('HistoryScanRouter.integration', () => {
	let app: express.Application;
	let getLatestScan: jest.Mocked<GetLatestScan>;
	let registerScan: jest.Mocked<RegisterScan>;
	let registerParsedLedgerHeaders: jest.Mocked<RegisterParsedLedgerHeaders>;
	let registerParsedTransactionEnvelopes: jest.Mocked<RegisterParsedTransactionEnvelopes>;
	let registerParsedTransactionResults: jest.Mocked<RegisterParsedTransactionResults>;
	let getScanJob: jest.Mocked<GetScanJob>;
	let releaseScanJob: jest.Mocked<ReleaseScanJob>;
	let touchScanJob: jest.Mocked<TouchScanJob>;
	let getScanLogs: jest.Mocked<GetScanLogs>;

	beforeEach(() => {
		getLatestScan = mock<GetLatestScan>();
		registerScan = mock<RegisterScan>();
		registerParsedLedgerHeaders = mock<RegisterParsedLedgerHeaders>();
		registerParsedTransactionEnvelopes =
			mock<RegisterParsedTransactionEnvelopes>();
		registerParsedTransactionResults = mock<RegisterParsedTransactionResults>();
		getScanJob = mock<GetScanJob>();
		releaseScanJob = mock<ReleaseScanJob>();
		touchScanJob = mock<TouchScanJob>();
		getScanLogs = mock<GetScanLogs>();

		app = express();
		app.use(express.json());
		app.use(
			'/history-scan',
			HistoryScanRouterWrapper({
				getLatestScan,
				getScanLogs,
				registerScan,
				registerParsedLedgerHeaders,
				registerParsedTransactionEnvelopes,
				registerParsedTransactionResults,
				getScanJob,
				releaseScanJob,
				touchScanJob,
				userName: 'admin',
				password: 'secret'
			})
		);
	});

	describe('GET /:url', () => {
		it('should return 400 for invalid URL', async () => {
			await request(app)
				.get('/history-scan/invalid-url')
				.expect(400)
				.expect('Content-Type', /json/)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
		});

		it('should return 400 when InvalidUrlError', async () => {
			getLatestScan.execute.mockResolvedValue(
				err(new InvalidUrlError('test.com'))
			);

			await request(app)
				.get('/history-scan/https%3A%2F%2Ftest.com')
				.expect(400)
				.expect((response) => {
					expect(response.body.error).toBe('Invalid url');
				});
		});

		it('should expose latest archive scans with frontend-aligned cache age', async () => {
			getLatestScan.execute.mockResolvedValue(ok(null));

			await request(app)
				.get('/history-scan/https%3A%2F%2Ftest.com')
				.expect(204)
				.expect('Cache-Control', 'public, max-age=10');
		});
	});

	describe('GET /logs/:url', () => {
		it('should expose archive scan logs with frontend-aligned cache age', async () => {
			getScanLogs.execute.mockResolvedValue(ok([]));

			await request(app)
				.get('/history-scan/logs/https%3A%2F%2Ftest.com')
				.expect(200)
				.expect('Cache-Control', 'public, max-age=10')
				.expect((response) => {
					expect(response.body).toEqual([]);
				});
		});
	});

	describe('POST /', () => {
		it('should require authentication', async () => {
			await request(app).post('/history-scan').send({}).expect(401);
		});

		it('should validate request body', async () => {
			await request(app)
				.post('/history-scan')
				.auth('admin', 'secret')
				.send({})
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});
		});

		it('should reject unsupported scan error types', async () => {
			const urlResult = Url.create('https://test.com');
			if (urlResult.isErr()) throw urlResult.error;

			const body = {
				startDate: new Date().toISOString(),
				endDate: new Date().toISOString(),
				baseUrl: urlResult.value.value,
				scanChainInitDate: new Date().toISOString(),
				latestVerifiedLedger: 100,
				latestScannedLedger: 100,
				latestScannedLedgerHeaderHash: null,
				concurrency: 5,
				isSlowArchive: false,
				fromLedger: 0,
				toLedger: null,
				error: null,
				errors: [
					{
						message: 'Unknown scanner failure',
						type: 'TYPE_UNKNOWN',
						url: urlResult.value.value
					}
				],
				scanJobRemoteId: 'test'
			};

			await request(app)
				.post('/history-scan')
				.auth('admin', 'secret')
				.send(body)
				.expect(400)
				.expect((response) => {
					expect(response.body.errors).toBeDefined();
				});

			expect(registerScan.execute).not.toHaveBeenCalled();
		});

		it('should register a new scan', async () => {
			const urlResult = Url.create('https://test.com');
			if (urlResult.isErr()) throw urlResult.error;

			const validBody: ScanDTO = {
				startDate: new Date(),
				endDate: new Date(),
				baseUrl: urlResult.value.value,
				scanChainInitDate: new Date(),
				latestVerifiedLedger: 100,
				latestScannedLedger: 100,
				latestScannedLedgerHeaderHash: null,
				concurrency: 5,
				isSlowArchive: false,
				fromLedger: 0,
				toLedger: null,
				error: null,
				errors: [],
				scanJobRemoteId: 'test'
			};

			registerScan.execute.mockResolvedValue(ok(undefined));

			await request(app)
				.post('/history-scan')
				.auth('admin', 'secret')
				.send(JSON.parse(JSON.stringify(validBody)))
				.expect(201)
				.expect((response) => {
					expect(response.body.message).toBe('Scan created successfully');
				});

			expect(registerScan.execute).toHaveBeenCalledWith(validBody);
		});
	});

	describe('POST /parsed-ledger-headers', () => {
		it('should require authentication', async () => {
			await request(app)
				.post('/history-scan/parsed-ledger-headers')
				.send({})
				.expect(401);
		});

		it('should validate parsed ledger header batches', async () => {
			await request(app)
				.post('/history-scan/parsed-ledger-headers')
				.auth('admin', 'secret')
				.send({})
				.expect(400);

			expect(registerParsedLedgerHeaders.execute).not.toHaveBeenCalled();
		});

		it('should register parsed ledger header batches', async () => {
			registerParsedLedgerHeaders.execute.mockResolvedValue(ok(undefined));

			const body = {
				headers: [
					{
						bucketListHash: 'bucket-list-hash',
						ledgerHeaderHash: 'ledger-header-hash',
						ledgerSequence: 63332922,
						previousLedgerHeaderHash: 'previous-ledger-header-hash',
						protocolVersion: 23,
						transactionResultHash: 'transaction-result-hash',
						transactionSetHash: 'transaction-set-hash'
					}
				],
				observedAt: '2026-07-05T01:42:51.000Z',
				scanJobRemoteId: 'scan-job-1',
				sourceArchiveUrl: 'https://history.stellar.org'
			};

			await request(app)
				.post('/history-scan/parsed-ledger-headers')
				.auth('admin', 'secret')
				.send(body)
				.expect(201)
				.expect((response) => {
					expect(response.body.message).toBe(
						'Parsed ledger headers registered'
					);
				});

			expect(registerParsedLedgerHeaders.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					headers: body.headers,
					scanJobRemoteId: body.scanJobRemoteId,
					sourceArchiveUrl: body.sourceArchiveUrl
				})
			);
		});
	});

	describe('POST /parsed-transaction-envelopes', () => {
		it('should require authentication', async () => {
			await request(app)
				.post('/history-scan/parsed-transaction-envelopes')
				.send({})
				.expect(401);
		});

		it('should validate parsed transaction envelope batches', async () => {
			await request(app)
				.post('/history-scan/parsed-transaction-envelopes')
				.auth('admin', 'secret')
				.send({})
				.expect(400);

			expect(registerParsedTransactionEnvelopes.execute).not.toHaveBeenCalled();
		});

		it('should register parsed transaction envelope batches', async () => {
			registerParsedTransactionEnvelopes.execute.mockResolvedValue(
				ok(undefined)
			);

			const body = {
				observedAt: '2026-07-07T19:30:00.000Z',
				records: [
					{
						envelopeXdr: 'AAAA-envelope',
						ledgerSequence: 63355967,
						transactionIndex: 4,
						transactionSetHash: 'transaction-set-hash'
					}
				],
				scanJobRemoteId: 'scan-job-1',
				sourceArchiveUrl: 'https://history.stellar.org'
			};

			await request(app)
				.post('/history-scan/parsed-transaction-envelopes')
				.auth('admin', 'secret')
				.send(body)
				.expect(201)
				.expect((response) => {
					expect(response.body.message).toBe(
						'Parsed transaction envelopes registered'
					);
				});

			expect(registerParsedTransactionEnvelopes.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					records: body.records,
					scanJobRemoteId: body.scanJobRemoteId,
					sourceArchiveUrl: body.sourceArchiveUrl
				})
			);
		});
	});

	describe('POST /parsed-transaction-results', () => {
		it('should require authentication', async () => {
			await request(app)
				.post('/history-scan/parsed-transaction-results')
				.send({})
				.expect(401);
		});

		it('should validate parsed transaction result batches', async () => {
			await request(app)
				.post('/history-scan/parsed-transaction-results')
				.auth('admin', 'secret')
				.send({})
				.expect(400);

			expect(registerParsedTransactionResults.execute).not.toHaveBeenCalled();
		});

		it('should register parsed transaction result batches', async () => {
			registerParsedTransactionResults.execute.mockResolvedValue(ok(undefined));

			const body = {
				observedAt: '2026-07-07T19:30:00.000Z',
				records: [
					{
						ledgerSequence: 63355967,
						resultXdr: 'AAAA-result',
						transactionHash: 'transaction-hash',
						transactionIndex: 4,
						transactionResultHash: 'transaction-result-hash'
					}
				],
				scanJobRemoteId: 'scan-job-1',
				sourceArchiveUrl: 'https://history.stellar.org'
			};

			await request(app)
				.post('/history-scan/parsed-transaction-results')
				.auth('admin', 'secret')
				.send(body)
				.expect(201)
				.expect((response) => {
					expect(response.body.message).toBe(
						'Parsed transaction results registered'
					);
				});

			expect(registerParsedTransactionResults.execute).toHaveBeenCalledWith(
				expect.objectContaining({
					records: body.records,
					scanJobRemoteId: body.scanJobRemoteId,
					sourceArchiveUrl: body.sourceArchiveUrl
				})
			);
		});
	});

	describe('GET /job', () => {
		it('should return 401 without authentication', async () => {
			await request(app).get('/history-scan/job').expect(401);
		});

		it('should return 401 with wrong credentials', async () => {
			await request(app)
				.get('/history-scan/job')
				.auth('admin', 'wrong-secret')
				.expect(401);
		});

		it('should return scan job when authenticated', async () => {
			const mockJob: ScanJob = new ScanJob('https://test.com', 100, 'hash');

			getScanJob.execute.mockResolvedValue(ok(mockJob));

			await request(app)
				.get('/history-scan/job')
				.auth('admin', 'secret')
				.expect(200)
				.expect('Content-Type', /json/)
				.expect((response) => {
					expect(response.body).toEqual(mockJob);
				});

			expect(getScanJob.execute).toHaveBeenCalled();
		});

		it('should return 500 when getScanJob fails', async () => {
			getScanJob.execute.mockResolvedValue(err(new Error('Database error')));

			await request(app)
				.get('/history-scan/job')
				.auth('admin', 'secret')
				.expect(500)
				.expect('Content-Type', /json/)
				.expect((response) => {
					expect(response.body.error).toBeDefined();
				});
		});

		it('should return 204 when no scan job available', async () => {
			getScanJob.execute.mockResolvedValue(ok(null));

			await request(app)
				.get('/history-scan/job')
				.auth('admin', 'secret')
				.expect(204);
		});
	});

	describe('POST /job/:remoteId/heartbeat', () => {
		it('should return 401 without authentication', async () => {
			await request(app)
				.post(`/history-scan/job/${randomUUID()}/heartbeat`)
				.expect(401);
		});

		it('should touch a taken scan job when authenticated', async () => {
			const remoteId = randomUUID();
			touchScanJob.execute.mockResolvedValue(ok(true));

			await request(app)
				.post(`/history-scan/job/${remoteId}/heartbeat`)
				.auth('admin', 'secret')
				.expect(204);

			expect(touchScanJob.execute).toHaveBeenCalledWith(
				remoteId,
				undefined,
				{}
			);
		});

		it('should pass scan progress when authenticated', async () => {
			const remoteId = randomUUID();
			const progress = {
				concurrency: 12,
				currentRangeFromLedger: 64,
				currentRangeToLedger: 96,
				fromLedger: 64,
				latestAttemptedLedger: 96,
				toLedger: 128,
				latestScannedLedger: 63,
				latestScannedLedgerHeaderHash: 'hash'
			};
			touchScanJob.execute.mockResolvedValue(ok(true));

			await request(app)
				.post(`/history-scan/job/${remoteId}/heartbeat`)
				.auth('admin', 'secret')
				.send(progress)
				.expect(204);

			expect(touchScanJob.execute).toHaveBeenCalledWith(
				remoteId,
				undefined,
				progress
			);
		});

		it('should return 404 when the scan job is not taken', async () => {
			const remoteId = randomUUID();
			touchScanJob.execute.mockResolvedValue(ok(false));

			await request(app)
				.post(`/history-scan/job/${remoteId}/heartbeat`)
				.auth('admin', 'secret')
				.expect(404);
		});
	});

	describe('POST /job/:remoteId/release', () => {
		it('should return 401 without authentication', async () => {
			await request(app)
				.post(`/history-scan/job/${randomUUID()}/release`)
				.expect(401);
		});

		it('should release a taken scan job when authenticated', async () => {
			const remoteId = randomUUID();
			releaseScanJob.execute.mockResolvedValue(ok(true));

			await request(app)
				.post(`/history-scan/job/${remoteId}/release`)
				.auth('admin', 'secret')
				.expect(204);

			expect(releaseScanJob.execute).toHaveBeenCalledWith(remoteId);
		});

		it('should return 404 when the scan job is not taken', async () => {
			const remoteId = randomUUID();
			releaseScanJob.execute.mockResolvedValue(ok(false));

			await request(app)
				.post(`/history-scan/job/${remoteId}/release`)
				.auth('admin', 'secret')
				.expect(404);
		});
	});
});
