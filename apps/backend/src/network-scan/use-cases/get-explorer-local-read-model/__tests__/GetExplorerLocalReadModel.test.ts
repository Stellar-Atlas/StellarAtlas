import { mock } from 'jest-mock-extended';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import type { ParsedLedgerHeaderRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedLedgerHeaderRepository.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetExplorerLocalReadModel } from '../GetExplorerLocalReadModel.js';

const networkPassphrase = 'Explorer read-model network';

describe('GetExplorerLocalReadModel', () => {
	it('reports complete canonical transaction and operation coverage', async () => {
		const parsed = parsedRepository();
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getCoverage.mockResolvedValue(canonicalCoverage());
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
					latestEvidence: {
						batchId: '00000000-0000-4000-8000-000000000001',
						checkpointProofId: 41
					},
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

	it('keeps operation readiness false until account-reference coverage is complete', async () => {
		const parsed = parsedRepository();
		const canonical = mock<FullHistoryCanonicalRepository>();
		canonical.getCoverage.mockResolvedValue(canonicalCoverage());
		canonical.getOperationCoverage.mockResolvedValue(
			operationCoverage(true, false)
		);

		await expect(
			new GetExplorerLocalReadModel(parsed, canonical, {
				networkPassphrase
			}).execute()
		).resolves.toMatchObject({
			indexes: {
				operationIndexReady: false,
				transactionIndexReady: true
			}
		});
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

function canonicalLatestEvidence() {
	const sourceObject = (seed: string, suffix: string) => ({
		contentDigest: FullHistoryHash.fromHex(seed.repeat(32)),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
	});
	return {
		archiveUrlIdentity: 'archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: fullHistoryLedgerSequence(63386303n),
		checkpointProofId: 41,
		decoderVersion: 'canonical-decoder/1',
		firstLedger: fullHistoryLedgerSequence(63386240n),
		ingestedAt: new Date('2026-07-08T16:11:00.000Z'),
		lastLedger: fullHistoryLedgerSequence(63386303n),
		proofEvaluatedAt: new Date('2026-07-08T16:10:00.000Z'),
		proofVersion: 5,
		sourceObjects: {
			checkpointState: sourceObject('11', '2'),
			ledger: sourceObject('22', '3'),
			results: sourceObject('33', '5'),
			transactions: sourceObject('44', '4')
		}
	};
}

function canonicalCoverage() {
	return {
		archiveSourceCount: 1,
		batchCount: 1,
		firstLedger: fullHistoryLedgerSequence(63386240n, 'firstLedger'),
		lastLedger: fullHistoryLedgerSequence(63386303n, 'lastLedger'),
		latestEvidence: canonicalLatestEvidence(),
		latestLedgerClosedAt: new Date('2026-07-08T16:09:36.000Z'),
		ledgerCount: 64,
		nextLedger: fullHistoryUint64(63386304n, 'nextLedger'),
		transactionCount: 26158,
		transactionResultCount: 26158,
		updatedAt: new Date('2026-07-12T03:19:10.000Z')
	};
}

function operationCoverage(
	operationFactsComplete: boolean,
	accountReferencesComplete = operationFactsComplete
) {
	const complete = operationFactsComplete && accountReferencesComplete;
	return {
		accountReferenceIndexedBatches: accountReferencesComplete ? 1 : 0,
		accountReferencesComplete,
		canonicalBatches: operationFactsComplete ? 1 : 0,
		complete,
		firstAccountReferenceIndexedLedger: accountReferencesComplete
			? fullHistoryLedgerSequence(63386240n)
			: null,
		firstIndexedLedger: operationFactsComplete
			? fullHistoryLedgerSequence(63386240n)
			: null,
		firstOutcomeIndexedLedger: operationFactsComplete
			? fullHistoryLedgerSequence(63386240n)
			: null,
		indexedBatches: operationFactsComplete ? 1 : 0,
		lastAccountReferenceIndexedLedger: accountReferencesComplete
			? fullHistoryLedgerSequence(63386303n)
			: null,
		lastIndexedLedger: operationFactsComplete
			? fullHistoryLedgerSequence(63386303n)
			: null,
		lastOutcomeIndexedLedger: operationFactsComplete
			? fullHistoryLedgerSequence(63386303n)
			: null,
		outcomeIndexedBatches: operationFactsComplete ? 1 : 0,
		operationFactsComplete,
		outcomesComplete: operationFactsComplete
	};
}
