import { mock, MockProxy } from 'jest-mock-extended';
import { DataSource } from 'typeorm';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { FullHistoryPromotionRuntimeRepository } from '@history-scan-coordinator/domain/full-history-promotion/FullHistoryPromotionRuntimeRepository.js';
import type { Config } from '@core/config/Config.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetFullHistoryStatus } from '../GetFullHistoryStatus.js';

describe('GetFullHistoryStatus', () => {
	let dataSourceMock: MockProxy<DataSource>;
	let parsedLedgerHeadersMock: MockProxy<ParsedLedgerHeaderRepository>;
	let canonicalHistoryMock: MockProxy<FullHistoryCanonicalRepository>;
	let canonicalPromotionMock: MockProxy<FullHistoryPromotionRuntimeRepository>;
	let configMock: MockProxy<Config>;
	let getFullHistoryStatus: GetFullHistoryStatus;

	beforeEach(() => {
		jest.useFakeTimers().setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
		dataSourceMock = mock<DataSource>();
		dataSourceMock.query.mockResolvedValue([]);
		parsedLedgerHeadersMock = mock<ParsedLedgerHeaderRepository>();
		canonicalHistoryMock = mock<FullHistoryCanonicalRepository>();
		canonicalHistoryMock.getCoverage.mockResolvedValue(null);
		canonicalHistoryMock.getOperationCoverage.mockResolvedValue({
			accountReferenceIndexedBatches: 0,
			accountReferencesComplete: false,
			canonicalBatches: 0,
			complete: false,
			firstAccountReferenceIndexedLedger: null,
			firstIndexedLedger: null,
			firstOutcomeIndexedLedger: null,
			indexedBatches: 0,
			lastAccountReferenceIndexedLedger: null,
			lastIndexedLedger: null,
			lastOutcomeIndexedLedger: null,
			outcomeIndexedBatches: 0,
			operationFactsComplete: false,
			outcomesComplete: false
		});
		canonicalPromotionMock = mock<FullHistoryPromotionRuntimeRepository>();
		canonicalPromotionMock.find.mockResolvedValue(null);
		configMock = mock<Config>();
		configMock.networkConfig = {
			...configMock.networkConfig,
			networkPassphrase: 'Public network'
		};
		getFullHistoryStatus = new GetFullHistoryStatus(
			dataSourceMock,
			parsedLedgerHeadersMock,
			canonicalHistoryMock,
			canonicalPromotionMock,
			configMock
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
			canonicalCoverage: null,
			canonicalPromotion: null,
			generatedAt: '2026-07-06T12:00:00.000Z',
			historicalBackfill: null,
			status: 'ok',
			mode: 'archive_header_parser',
			parsedLedgerCount: 2,
			earliestParsedLedger: '1',
			latestParsedLedger: '128',
			latestObservedAt: '2026-07-06T11:59:00.000Z',
			ledgerCloseMeta: null,
			sourceArchiveCount: 1,
			localTransactionIndexReady: false,
			localOperationIndexReady: false,
			localAssetIndexReady: false,
			localContractIndexReady: false
		});
		expect(parsedLedgerHeadersMock.getWatermark).toHaveBeenCalledTimes(1);
		expect(dataSourceMock.query).toHaveBeenCalledTimes(2);
	});

	it('reports the exact bounded canonical range without claiming later indexes', async () => {
		parsedLedgerHeadersMock.getWatermark.mockResolvedValue({
			earliestLedgerSequence: 1,
			latestLedgerHeaderHash: 'hash',
			latestLedgerSequence: 63386367,
			latestObservedAt: new Date('2026-07-06T11:59:00.000Z'),
			parsedLedgerCount: 128,
			sourceArchiveCount: 2
		});
		canonicalHistoryMock.getCoverage.mockResolvedValue({
			archiveSourceCount: 1,
			batchCount: 2,
			firstLedger: fullHistoryLedgerSequence(63386240n, 'firstLedger'),
			lastLedger: fullHistoryLedgerSequence(63386367n, 'lastLedger'),
			latestEvidence: canonicalLatestEvidence(),
			latestLedgerClosedAt: new Date('2026-07-06T11:58:30.000Z'),
			ledgerCount: 128,
			nextLedger: fullHistoryUint64(63386368n, 'nextLedger'),
			transactionCount: 52000,
			transactionResultCount: 52000,
			updatedAt: new Date('2026-07-06T11:59:30.000Z')
		});
		canonicalHistoryMock.getOperationCoverage.mockResolvedValue({
			accountReferenceIndexedBatches: 2,
			accountReferencesComplete: true,
			canonicalBatches: 2,
			complete: true,
			firstAccountReferenceIndexedLedger: fullHistoryLedgerSequence(63386240n),
			firstIndexedLedger: fullHistoryLedgerSequence(63386240n),
			firstOutcomeIndexedLedger: fullHistoryLedgerSequence(63386240n),
			indexedBatches: 2,
			lastAccountReferenceIndexedLedger: fullHistoryLedgerSequence(63386367n),
			lastIndexedLedger: fullHistoryLedgerSequence(63386367n),
			lastOutcomeIndexedLedger: fullHistoryLedgerSequence(63386367n),
			outcomeIndexedBatches: 2,
			operationFactsComplete: true,
			outcomesComplete: true
		});
		canonicalPromotionMock.find.mockResolvedValue({
			checkpointLedger: 63386431,
			heartbeatAt: new Date('2026-07-06T11:59:55.000Z'),
			instanceId: '00000000-0000-4000-8000-000000000001',
			lastAttemptAt: new Date('2026-07-06T11:59:54.000Z'),
			lastErrorCode: null,
			lastFailureAt: null,
			lastOutcome: 'proof-pending',
			lastSuccessAt: new Date('2026-07-06T11:59:00.000Z'),
			nextLedger: fullHistoryUint64(63386368n, 'nextLedger'),
			startedAt: new Date('2026-07-06T11:50:00.000Z'),
			state: 'waiting-for-proof'
		});
		dataSourceMock.query
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{
					firstLedger: '63386240',
					jobState: 'pending',
					latestErrorCode: 'proof-pending',
					updatedAt: new Date('2026-07-06T11:59:50.000Z')
				}
			]);

		const result = await getFullHistoryStatus.executeFullHistory();

		expect(result._unsafeUnwrap()).toMatchObject({
			canonicalCoverage: {
				archiveSourceCount: 1,
				batchCount: 2,
				firstLedger: '63386240',
				lastLedger: '63386367',
				latestEvidence: {
					archiveUrlIdentity: 'archive.example/v2',
					batchId: '00000000-0000-4000-8000-000000000001',
					checkpointLedger: '63386367',
					checkpointProofId: 41,
					decoderVersion: 'canonical-decoder/1',
					firstLedger: '63386304',
					ingestedAt: '2026-07-06T11:59:30.000Z',
					lastLedger: '63386367',
					proofEvaluatedAt: '2026-07-06T11:59:00.000Z',
					proofVersion: 5,
					sourceObjects: {
						checkpointState: {
							algorithm: 'sha256',
							contentDigest: '11'.repeat(32),
							representation: 'canonical-json'
						},
						ledger: {
							algorithm: 'sha256',
							contentDigest: '22'.repeat(32),
							representation: 'uncompressed-xdr'
						},
						results: {
							algorithm: 'sha256',
							contentDigest: '33'.repeat(32),
							representation: 'uncompressed-xdr'
						},
						transactions: {
							algorithm: 'sha256',
							contentDigest: '44'.repeat(32),
							representation: 'uncompressed-xdr'
						}
					}
				},
				latestLedgerClosedAt: '2026-07-06T11:58:30.000Z',
				ledgerCount: 128,
				nextLedger: '63386368',
				rangeKind: 'contiguous_bounded',
				source: 'postgres_canonical',
				transactionCount: 52000,
				transactionResultCount: 52000,
				updatedAt: '2026-07-06T11:59:30.000Z'
			},
			canonicalPromotion: {
				checkpointLedger: '63386431',
				heartbeatAt: '2026-07-06T11:59:55.000Z',
				lastOutcome: 'proof-pending',
				nextLedger: '63386368',
				state: 'waiting-for-proof'
			},
			historicalBackfill: {
				failedJobs: 0,
				latestErrorCode: 'proof-pending',
				nextCheckpointLedger: '63386239',
				pendingJobs: 1,
				runningJobs: 0,
				state: 'waiting-for-proof',
				updatedAt: '2026-07-06T11:59:50.000Z'
			},
			localAssetIndexReady: false,
			localContractIndexReady: false,
			localOperationIndexReady: true,
			localTransactionIndexReady: true,
			mode: 'canonical_checkpoint_index',
			status: 'ok'
		});
	});

	function canonicalLatestEvidence() {
		const sourceObject = (seed: string, suffix: string) => ({
			contentDigest: FullHistoryHash.fromHex(seed.repeat(32)),
			objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
		});
		return {
			archiveUrlIdentity: 'https://archive.example/v2?Token=secret',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: fullHistoryLedgerSequence(63386367n),
			checkpointProofId: 41,
			decoderVersion: 'canonical-decoder/1',
			firstLedger: fullHistoryLedgerSequence(63386304n),
			ingestedAt: new Date('2026-07-06T11:59:30.000Z'),
			lastLedger: fullHistoryLedgerSequence(63386367n),
			proofEvaluatedAt: new Date('2026-07-06T11:59:00.000Z'),
			proofVersion: 5,
			sourceObjects: {
				checkpointState: sourceObject('11', '2'),
				ledger: sourceObject('22', '3'),
				results: sourceObject('33', '5'),
				transactions: sourceObject('44', '4')
			}
		};
	}

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
		expect(dataSourceMock.query).toHaveBeenCalledTimes(3);
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
