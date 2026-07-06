import { mock, MockProxy } from 'jest-mock-extended';
import { DataSource } from 'typeorm';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import { GetFullHistoryStatus } from '../GetFullHistoryStatus.js';

describe('GetFullHistoryStatus', () => {
	let dataSourceMock: MockProxy<DataSource>;
	let parsedLedgerHeadersMock: MockProxy<ParsedLedgerHeaderRepository>;
	let getFullHistoryStatus: GetFullHistoryStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
		dataSourceMock = mock<DataSource>();
		parsedLedgerHeadersMock = mock<ParsedLedgerHeaderRepository>();
		getFullHistoryStatus = new GetFullHistoryStatus(
			dataSourceMock,
			parsedLedgerHeadersMock
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should map full-history status from the parsed-header repository', async () => {
		parsedLedgerHeadersMock.getWatermark.mockResolvedValue({
			earliestLedgerSequence: 1,
			latestLedgerHeaderHash: 'latest-header-hash',
			latestLedgerSequence: 128,
			latestObservedAt: new Date('2026-07-06T11:59:00.000Z'),
			parsedLedgerCount: 2,
			sourceArchiveCount: 1
		});

		const result = await getFullHistoryStatus.executeFullHistory();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-06T12:00:00.000Z',
			status: 'ok',
			mode: 'archive_header_parser',
			parsedLedgerCount: 2,
			earliestParsedLedger: '1',
			latestParsedLedger: '128',
			latestObservedAt: '2026-07-06T11:59:00.000Z',
			sourceArchiveCount: 1,
			localTransactionIndexReady: false,
			localOperationIndexReady: false,
			localAssetIndexReady: false,
			localContractIndexReady: false
		});
		expect(parsedLedgerHeadersMock.getWatermark).toHaveBeenCalledTimes(1);
		expect(dataSourceMock.query).not.toHaveBeenCalled();
	});

	it('should keep header-only status unavailable when no headers are parsed', async () => {
		parsedLedgerHeadersMock.getWatermark.mockResolvedValue({
			earliestLedgerSequence: null,
			latestLedgerHeaderHash: null,
			latestLedgerSequence: null,
			latestObservedAt: null,
			parsedLedgerCount: 0,
			sourceArchiveCount: 0
		});

		const result = await getFullHistoryStatus.executeFullHistory();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			status: 'unavailable',
			earliestParsedLedger: null,
			latestParsedLedger: null,
			latestObservedAt: null,
			localTransactionIndexReady: false,
			localOperationIndexReady: false,
			localAssetIndexReady: false,
			localContractIndexReady: false
		});
	});

	it('should combine parsed-header watermark with queue status for ingestion', async () => {
		parsedLedgerHeadersMock.getWatermark.mockResolvedValue({
			earliestLedgerSequence: 64,
			latestLedgerHeaderHash: 'latest-header-hash',
			latestLedgerSequence: 256,
			latestObservedAt: new Date('2026-07-06T11:58:00.000Z'),
			parsedLedgerCount: 3,
			sourceArchiveCount: 2
		});
		dataSourceMock.query.mockResolvedValueOnce([
			{
				doneJobs: '5',
				latestJobUpdateAt: new Date('2026-07-06T11:57:00.000Z'),
				pendingJobs: '1',
				takenJobs: '2'
			}
		]);

		const result = await getFullHistoryStatus.executeIngestion();

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toMatchObject({
			parsedLedgerCount: 3,
			earliestParsedLedger: '64',
			latestParsedLedger: '256',
			queue: {
				doneJobs: 5,
				latestJobUpdateAt: '2026-07-06T11:57:00.000Z',
				pendingJobs: 1,
				takenJobs: 2
			}
		});
		expect(parsedLedgerHeadersMock.getWatermark).toHaveBeenCalledTimes(1);
		expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
		expect(dataSourceMock.query.mock.calls[0]?.[0]).toContain(
			'history_archive_scan_job_queue'
		);
	});

	it('should map indexing ranges from the parsed-header repository', async () => {
		parsedLedgerHeadersMock.findSourceRanges.mockResolvedValue([
			{
				archiveUrl: 'https://history.example',
				earliestLedgerSequence: 1,
				latestLedgerSequence: 64,
				latestObservedAt: new Date('2026-07-06T11:55:00.000Z'),
				parsedLedgerCount: 2
			}
		]);

		const result = await getFullHistoryStatus.executeRanges(5);

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-06T12:00:00.000Z',
			limit: 5,
			ranges: [
				{
					archiveUrl: 'https://history.example',
					earliestParsedLedger: '1',
					latestObservedAt: '2026-07-06T11:55:00.000Z',
					latestParsedLedger: '64',
					parsedLedgerCount: 2
				}
			]
		});
		expect(parsedLedgerHeadersMock.findSourceRanges).toHaveBeenCalledWith(5);
		expect(dataSourceMock.query).not.toHaveBeenCalled();
	});

	it('should map ledger ingestion status from the parsed-header repository', async () => {
		parsedLedgerHeadersMock.findByLedgerSequence.mockResolvedValue({
			bucketListHash: 'bucket-list-hash',
			lastSourceArchiveUrl: 'https://history.example',
			ledgerHeaderHash: 'ledger-header-hash',
			protocolVersion: 27,
			transactionResultHash: 'result-hash',
			transactionSetHash: 'tx-set-hash'
		});

		const result = await getFullHistoryStatus.executeLedger('64');

		expect(result.isOk()).toBe(true);
		expect(result._unsafeUnwrap()).toEqual({
			generatedAt: '2026-07-06T12:00:00.000Z',
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
		});
		expect(parsedLedgerHeadersMock.findByLedgerSequence).toHaveBeenCalledWith(
			64
		);
		expect(dataSourceMock.query).not.toHaveBeenCalled();
	});

	it('should return repository errors without claiming full-history coverage', async () => {
		const error = new Error('parsed header repository unavailable');
		parsedLedgerHeadersMock.getWatermark.mockRejectedValue(error);

		const result = await getFullHistoryStatus.executeFullHistory();

		expect(result.isErr()).toBe(true);
		expect(result._unsafeUnwrapErr()).toBe(error);
	});
});
