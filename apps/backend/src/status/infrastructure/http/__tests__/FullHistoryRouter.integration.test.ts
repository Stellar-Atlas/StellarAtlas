import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { err, ok } from 'neverthrow';
import { fullHistoryRouter } from '../FullHistoryRouter.js';
import { GetFullHistoryStatus } from '@status/use-cases/get-full-history-status/GetFullHistoryStatus.js';

describe('FullHistoryRouter.integration', () => {
	let app: express.Application;
	let getFullHistoryStatus: jest.Mocked<GetFullHistoryStatus>;

	beforeEach(() => {
		getFullHistoryStatus = mock<GetFullHistoryStatus>();
		app = express();
		app.use(
			'/v1',
			fullHistoryRouter({
				getFullHistoryStatus
			})
		);
	});

	it('exposes full-history parser status', async () => {
		getFullHistoryStatus.executeFullHistory.mockResolvedValue(
			ok({
				generatedAt: '2026-07-05T15:00:00.000Z',
				status: 'degraded',
				mode: 'archive_header_parser',
				parsedLedgerCount: 100,
				earliestParsedLedger: '1',
				latestParsedLedger: '100',
				latestObservedAt: '2026-07-05T14:59:00.000Z',
				sourceArchiveCount: 2,
				localTransactionIndexReady: false,
				localOperationIndexReady: false,
				localAssetIndexReady: false,
				localContractIndexReady: false
			})
		);

		await request(app)
			.get('/v1/status/full-history')
			.expect(200)
			.expect('Cache-Control', 'public, max-age=10')
			.expect((response) => {
				expect(response.body.mode).toBe('archive_header_parser');
				expect(response.body.localTransactionIndexReady).toBe(false);
			});
	});

	it('exposes bounded indexing jobs', async () => {
		getFullHistoryStatus.executeJobs.mockResolvedValue(
			ok({
				generatedAt: '2026-07-05T15:00:00.000Z',
				limit: 5,
				summary: {
					doneJobs: 1,
					pendingJobs: 2,
					takenJobs: 3,
					latestJobUpdateAt: '2026-07-05T14:59:00.000Z'
				},
				jobs: [
					{
						concurrency: 24,
						fromLedger: '1',
						latestScannedLedger: '64',
						remoteId: 'remote-id',
						status: 'TAKEN',
						toLedger: '128',
						updatedAt: '2026-07-05T14:59:00.000Z',
						url: 'https://history.example'
					}
				]
			})
		);

		await request(app)
			.get('/v1/indexing/jobs?limit=5')
			.expect(200)
			.expect((response) => {
				expect(response.body.jobs[0].status).toBe('TAKEN');
				expect(getFullHistoryStatus.executeJobs).toHaveBeenCalledWith(5);
			});
	});

	it('rejects unbounded indexing job limits', async () => {
		await request(app)
			.get('/v1/indexing/jobs?limit=500')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid limit' });
			});

		expect(getFullHistoryStatus.executeJobs).not.toHaveBeenCalled();
	});

	it('exposes ledger ingestion status', async () => {
		getFullHistoryStatus.executeLedger.mockResolvedValue(
			ok({
				generatedAt: '2026-07-05T15:00:00.000Z',
				header: {
					bucketListHash: 'bucket-list-hash',
					ledgerHeaderHash: 'ledger-header-hash',
					protocolVersion: 27,
					sourceArchiveUrl: 'https://history.example',
					transactionResultHash: 'result-hash',
					transactionSetHash: 'tx-set-hash'
				},
				ledger: '64',
				parsedHeaderAvailable: true,
				status: 'parsed'
			})
		);

		await request(app)
			.get('/v1/ledgers/64/ingestion-status')
			.expect(200)
			.expect((response) => {
				expect(response.body.status).toBe('parsed');
				expect(getFullHistoryStatus.executeLedger).toHaveBeenCalledWith('64');
			});
	});

	it('rejects invalid ledger ingestion status lookups', async () => {
		await request(app)
			.get('/v1/ledgers/not-a-ledger/ingestion-status')
			.expect(400)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Invalid ledger sequence' });
			});

		expect(getFullHistoryStatus.executeLedger).not.toHaveBeenCalled();
	});

	it('maps use case failures to 500', async () => {
		getFullHistoryStatus.executeIngestion.mockResolvedValue(
			err(new Error('database unavailable'))
		);

		await request(app)
			.get('/v1/status/ingestion')
			.expect(500)
			.expect((response) => {
				expect(response.body).toEqual({ error: 'Internal server error' });
			});
	});
});
