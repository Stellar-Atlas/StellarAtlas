import { mock } from 'jest-mock-extended';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetExplorerLocalReadModel } from '../GetExplorerLocalReadModel.js';

const networkPassphrase = 'Explorer read-model network';

describe('GetExplorerLocalReadModel', () => {
	it('reports complete canonical transaction and operation coverage', async () => {
		const parsed = parsedRepository();
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getCoverage.mockResolvedValue({
			archiveSourceCount: 1,
			batchCount: 1,
			firstLedger: fullHistoryLedgerSequence(63386240n, 'firstLedger'),
			lastLedger: fullHistoryLedgerSequence(63386303n, 'lastLedger'),
			latestLedgerClosedAt: new Date('2026-07-08T16:09:36.000Z'),
			ledgerCount: 64,
			nextLedger: fullHistoryUint64(63386304n, 'nextLedger'),
			transactionCount: 26158,
			transactionResultCount: 26158,
			updatedAt: new Date('2026-07-12T03:19:10.000Z')
		});
		canonical.getOperationCoverage.mockResolvedValue(operationCoverage(true));

		const result = await new GetExplorerLocalReadModel(parsed, canonical, {
			networkPassphrase
		}).execute();

		expect(result).toMatchObject({
			indexes: {
				assetIndexReady: false,
				contractIndexReady: false,
				operationIndexReady: true,
				transactionIndexReady: true
			},
			transactions: {
				canonicalCoverage: {
					firstLedger: '63386240',
					lastLedger: '63386303',
					transactionCount: 26158
				},
				localCoverage: true,
				source: 'postgres_canonical'
			}
		});
		expect(canonical.getCoverage).toHaveBeenCalledWith(networkPassphrase);
		expect(parsed.getWatermark).not.toHaveBeenCalled();
		expect(result.source).toBe('full_history_canonical_repository');
	});

	it('retains Horizon fallback when no canonical range exists', async () => {
		const parsed = parsedRepository();
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getCoverage.mockResolvedValue(null);
		canonical.getOperationCoverage.mockResolvedValue(operationCoverage(false));

		await expect(
			new GetExplorerLocalReadModel(parsed, canonical, {
				networkPassphrase
			}).execute()
		).resolves.toMatchObject({
			indexes: { transactionIndexReady: false },
			parsedLedgerHeaders: {
				latestParsedLedger: '128',
				parsedLedgerCount: 2
			},
			transactions: {
				canonicalCoverage: null,
				localCoverage: false,
				source: 'horizon_fallback'
			}
		});
		expect(parsed.getWatermark).toHaveBeenCalledTimes(1);
	});
});

function parsedRepository(): ParsedLedgerHeaderRepository {
	const repository = mock<ParsedLedgerHeaderRepository>();
	repository.getWatermark.mockResolvedValue({
		earliestLedgerSequence: 64,
		latestLedgerHeaderHash: 'hash-128',
		latestLedgerSequence: 128,
		latestObservedAt: new Date('2026-07-12T03:00:00.000Z'),
		parsedLedgerCount: 2,
		sourceArchiveCount: 1
	});
	return repository;
}

function operationCoverage(complete: boolean) {
	return {
		canonicalBatches: complete ? 1 : 0,
		complete,
		firstIndexedLedger: complete ? fullHistoryLedgerSequence(63386240n) : null,
		indexedBatches: complete ? 1 : 0,
		lastIndexedLedger: complete ? fullHistoryLedgerSequence(63386303n) : null
	};
}
