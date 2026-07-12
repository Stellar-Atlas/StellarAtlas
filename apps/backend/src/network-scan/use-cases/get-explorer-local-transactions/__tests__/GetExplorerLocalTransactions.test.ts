import { mock } from 'jest-mock-extended';
import type { FullHistoryCanonicalRepository } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalRepository.js';
import {
	fullHistoryLedgerSequence,
	fullHistoryUint64,
	FullHistoryHash
} from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalTypes.js';
import { GetExplorerLocalTransactions } from '../GetExplorerLocalTransactions.js';

const networkPassphrase = 'Explorer canonical network';
const transactionHash = 'ab'.repeat(32);

describe('GetExplorerLocalTransactions', () => {
	it('maps bounded canonical recent transactions without claiming later indexes', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.findRecentTransactions.mockResolvedValue({
			records: [canonicalTransaction()],
			truncated: true
		});
		repository.getCoverage.mockResolvedValue(canonicalCoverage());

		const result = await new GetExplorerLocalTransactions(repository, {
			networkPassphrase
		}).execute(5);

		expect(result).toMatchObject({
			canonicalCoverage: {
				firstLedger: '63386240',
				lastLedger: '63386303',
				rangeKind: 'contiguous_bounded',
				transactionCount: 26158,
				transactionResultCount: 26158
			},
			count: 1,
			limit: 5,
			readModel: {
				assetIndexReady: false,
				contractIndexReady: false,
				evidenceSelection: 'proof_gated_canonical_transaction_and_result',
				operationIndexReady: false,
				transactionIndexReady: true
			},
			records: [
				{
					createdAt: '2026-07-08T16:09:36.000Z',
					feeCharged: '100',
					hash: transactionHash,
					ledger: '63386303',
					operationCount: 2,
					source: 'postgres_canonical',
					sourceAccount: `G${'A'.repeat(55)}`,
					successful: true
				}
			],
			source: 'postgres_canonical',
			truncated: true
		});
		expect(repository.findRecentTransactions).toHaveBeenCalledWith(
			networkPassphrase,
			5
		);
		expect(repository.getCoverage).toHaveBeenCalledWith(networkPassphrase);
	});

	it('returns an empty bounded result when canonical coverage is absent', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.findRecentTransactions.mockResolvedValue({
			records: [],
			truncated: false
		});
		repository.getCoverage.mockResolvedValue(null);

		await expect(
			new GetExplorerLocalTransactions(repository, {
				networkPassphrase
			}).execute(10)
		).resolves.toMatchObject({
			canonicalCoverage: null,
			count: 0,
			readModel: { transactionIndexReady: false },
			records: [],
			truncated: false
		});
	});

	it('finds a canonical transaction by its normalized hash', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.findTransaction.mockResolvedValue(canonicalTransaction());
		const useCase = new GetExplorerLocalTransactions(repository, {
			networkPassphrase
		});

		await expect(useCase.findByHash(transactionHash)).resolves.toMatchObject({
			hash: transactionHash,
			ledger: '63386303',
			source: 'postgres_canonical'
		});
		const calledHash = repository.findTransaction.mock.calls[0]?.[1];
		expect(calledHash?.toHex()).toBe(transactionHash);
	});

	it('rejects canonical rows without a matching coverage watermark', async () => {
		const repository = mock<FullHistoryCanonicalRepository>();
		repository.findRecentTransactions.mockResolvedValue({
			records: [canonicalTransaction()],
			truncated: false
		});
		repository.getCoverage.mockResolvedValue(null);

		await expect(
			new GetExplorerLocalTransactions(repository, {
				networkPassphrase
			}).execute(5)
		).rejects.toThrow(
			'Canonical transactions exist without canonical coverage'
		);
	});
});

function canonicalTransaction() {
	return {
		closedAt: new Date('2026-07-08T16:09:36.000Z'),
		envelopeType: 'tx' as const,
		feeBid: fullHistoryUint64(100n, 'feeBid'),
		feeCharged: fullHistoryUint64(100n, 'feeCharged'),
		ledgerSequence: fullHistoryLedgerSequence(63386303n, 'ledgerSequence'),
		operationCount: 2,
		operationResultCount: 2,
		resultCode: 0,
		sourceAccount: `G${'A'.repeat(55)}`,
		sourceAccountSequence: fullHistoryUint64(42n, 'sourceAccountSequence'),
		successful: true,
		transactionHash: FullHistoryHash.fromHex(transactionHash),
		transactionIndex: 7
	};
}

function canonicalCoverage() {
	return {
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
	};
}
