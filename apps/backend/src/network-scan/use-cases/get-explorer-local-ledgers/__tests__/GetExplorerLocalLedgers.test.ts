import { mock } from 'jest-mock-extended';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetExplorerLocalLedgers } from '../GetExplorerLocalLedgers.js';

const networkPassphrase = 'Explorer canonical ledger network';
const firstLedger = fullHistoryLedgerSequence('63386240');
const lastLedger = fullHistoryLedgerSequence('63386303');

describe('GetExplorerLocalLedgers', () => {
	it('maps an exact canonical ledger with proof, source, and freshness', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(canonicalCoverage());
		repository.findLedgerRange.mockResolvedValue({
			records: [canonicalLedger(firstLedger)]
		});
		const useCase = new GetExplorerLocalLedgers(repository, {
			networkPassphrase
		});

		await expect(useCase.findBySequence(firstLedger)).resolves.toMatchObject({
			canonicalCoverage: {
				firstLedger,
				lastLedger,
				rangeKind: 'contiguous_bounded'
			},
			ledger: {
				bucketListHash: '55'.repeat(32),
				closedAt: '2026-07-08T16:09:36.000Z',
				evidence: {
					archiveSource: 'archive.example/stellar',
					batchId: '00000000-0000-4000-8000-000000000001',
					checkpointProofId: 41,
					proofVersion: 5,
					sourceObject: {
						algorithm: 'sha256',
						contentDigest: '66'.repeat(32),
						representation: 'uncompressed-xdr'
					}
				},
				freshness: {
					ingestedAt: '2026-07-08T16:11:00.000Z',
					proofEvaluatedAt: '2026-07-08T16:10:00.000Z'
				},
				hash: '11'.repeat(32),
				sequence: firstLedger,
				source: 'postgres_canonical'
			},
			requestedRange: { firstLedger, lastLedger: firstLedger },
			source: 'postgres_canonical',
			status: 'available'
		});
		expect(repository.findLedgerRange).toHaveBeenCalledWith(networkPassphrase, {
			firstLedger,
			lastLedger: firstLedger
		});
	});

	it('returns a complete ordered range from canonical coverage', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(canonicalCoverage());
		const secondLedger = fullHistoryLedgerSequence('63386241');
		repository.findLedgerRange.mockResolvedValue({
			records: [canonicalLedger(firstLedger), canonicalLedger(secondLedger)]
		});

		await expect(
			new GetExplorerLocalLedgers(repository, {
				networkPassphrase
			}).findRange({ firstLedger, lastLedger: secondLedger })
		).resolves.toMatchObject({
			count: 2,
			records: [{ sequence: firstLedger }, { sequence: secondLedger }],
			requestedRange: { firstLedger, lastLedger: secondLedger },
			status: 'available'
		});
	});

	it('reports out-of-coverage requests as unavailable without reading rows', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(canonicalCoverage());
		const requested = fullHistoryLedgerSequence('63386239');

		await expect(
			new GetExplorerLocalLedgers(repository, {
				networkPassphrase
			}).findBySequence(requested)
		).resolves.toMatchObject({
			canonicalCoverage: { firstLedger, lastLedger },
			reason: 'outside_canonical_coverage',
			requestedRange: { firstLedger: requested, lastLedger: requested },
			status: 'unavailable'
		});
		expect(repository.findLedgerRange).not.toHaveBeenCalled();
	});

	it('reports an empty canonical store as unavailable', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(null);

		await expect(
			new GetExplorerLocalLedgers(repository, {
				networkPassphrase
			}).findBySequence(firstLedger)
		).resolves.toMatchObject({
			canonicalCoverage: null,
			reason: 'canonical_coverage_empty',
			status: 'unavailable'
		});
		expect(repository.findLedgerRange).not.toHaveBeenCalled();
	});

	it('uses not_found only for an absent sequence inside declared coverage', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(canonicalCoverage());
		repository.findLedgerRange.mockResolvedValue({ records: [] });

		await expect(
			new GetExplorerLocalLedgers(repository, {
				networkPassphrase
			}).findBySequence(firstLedger)
		).resolves.toMatchObject({
			reason: 'ledger_absent_within_canonical_coverage',
			status: 'not_found'
		});
	});

	it('rejects a missing row inside a covered range as a consistency failure', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.getCoverage.mockResolvedValue(canonicalCoverage());
		repository.findLedgerRange.mockResolvedValue({
			records: [canonicalLedger(firstLedger)]
		});

		await expect(
			new GetExplorerLocalLedgers(repository, {
				networkPassphrase
			}).findRange({
				firstLedger,
				lastLedger: fullHistoryLedgerSequence('63386241')
			})
		).rejects.toThrow('Canonical ledger coverage contains a row gap');
	});
});

function canonicalLedger(ledgerSequence: typeof firstLedger) {
	return {
		bucketListHash: FullHistoryHash.fromHex('55'.repeat(32)),
		closedAt: new Date('2026-07-08T16:09:36.000Z'),
		evidence: {
			archiveUrlIdentity: 'https://archive.example/stellar/',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: lastLedger,
			checkpointProofId: 41,
			decoderVersion: 'canonical-decoder/1',
			ingestedAt: new Date('2026-07-08T16:11:00.000Z'),
			ledgerSourceObject: {
				contentDigest: FullHistoryHash.fromHex('66'.repeat(32)),
				objectRemoteId: '00000000-0000-4000-8000-000000000003'
			},
			proofEvaluatedAt: new Date('2026-07-08T16:10:00.000Z'),
			proofVersion: 5
		},
		ledgerHash: FullHistoryHash.fromHex('11'.repeat(32)),
		ledgerSequence,
		operationCount: 27,
		previousLedgerHash: FullHistoryHash.fromHex('22'.repeat(32)),
		protocolVersion: 27,
		transactionCount: 11,
		transactionResultHash: FullHistoryHash.fromHex('33'.repeat(32)),
		transactionSetHash: FullHistoryHash.fromHex('44'.repeat(32))
	};
}

function canonicalCoverage() {
	const sourceObject = (seed: string, suffix: string) => ({
		contentDigest: FullHistoryHash.fromHex(seed.repeat(32)),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`
	});
	return {
		archiveSourceCount: 1,
		batchCount: 1,
		firstLedger,
		lastLedger,
		latestEvidence: {
			archiveUrlIdentity: 'https://archive.example/stellar/',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: lastLedger,
			checkpointProofId: 41,
			decoderVersion: 'canonical-decoder/1',
			firstLedger,
			ingestedAt: new Date('2026-07-08T16:11:00.000Z'),
			lastLedger,
			proofEvaluatedAt: new Date('2026-07-08T16:10:00.000Z'),
			proofVersion: 5,
			sourceObjects: {
				checkpointState: sourceObject('77', '2'),
				ledger: sourceObject('66', '3'),
				results: sourceObject('88', '5'),
				transactions: sourceObject('99', '4')
			}
		},
		latestLedgerClosedAt: new Date('2026-07-08T16:09:36.000Z'),
		ledgerCount: 64,
		nextLedger: fullHistoryUint64('63386304'),
		transactionCount: 26158,
		transactionResultCount: 26158,
		updatedAt: new Date('2026-07-12T03:19:10.000Z')
	};
}
