import { GetExplorerLocalTransactions } from '../GetExplorerLocalTransactions.js';
import type { ParsedTransactionResultRepository } from '@history-scan-coordinator/domain/parsed-history/ParsedTransactionResultRepository.js';

describe('GetExplorerLocalTransactions', () => {
	it('maps recent parsed transaction rows into local explorer evidence', async () => {
		const repository = createRepository([
			{
				envelopeObservedAt: new Date('2026-07-07T19:32:00.000Z'),
				envelopeSourceArchiveUrl: 'https://archive-a.example',
				headerObservedAt: new Date('2026-07-07T19:31:00.000Z'),
				headerSourceArchiveUrl: 'https://archive-b.example',
				ledgerHeaderHash: 'ledger-header-hash',
				ledgerSequence: 63355967,
				protocolVersion: 27,
				resultObservedAt: new Date('2026-07-07T19:33:00.000Z'),
				resultSourceArchiveUrl: 'https://archive-c.example',
				transactionHash: 'a'.repeat(64),
				transactionIndex: 4,
				transactionResultHash: 'transaction-result-hash',
				transactionSetHash: 'transaction-set-hash'
			}
		]);

		await expect(
			new GetExplorerLocalTransactions(repository).execute(5)
		).resolves.toMatchObject({
			count: 1,
			limit: 5,
			readModel: {
				assetIndexReady: false,
				contractIndexReady: false,
				envelopeJoinReady: true,
				ledgerHeaderJoinReady: true,
				operationIndexReady: false,
				parsedTransactionResultsReady: true
			},
			records: [
				{
					joins: {
						envelopeAvailable: true,
						ledgerHeaderAvailable: true
					},
					ledger: '63355967',
					ledgerHeaderHash: 'ledger-header-hash',
					localEvidence: {
						envelopeObservedAt: '2026-07-07T19:32:00.000Z',
						envelopeSourceArchiveUrl: 'https://archive-a.example',
						ledgerHeaderObservedAt: '2026-07-07T19:31:00.000Z',
						ledgerHeaderSourceArchiveUrl: 'https://archive-b.example',
						resultObservedAt: '2026-07-07T19:33:00.000Z',
						resultSourceArchiveUrl: 'https://archive-c.example'
					},
					protocolVersion: 27,
					transactionHash: 'a'.repeat(64),
					transactionIndex: 4,
					transactionResultHash: 'transaction-result-hash',
					transactionSetHash: 'transaction-set-hash'
				}
			],
			source: 'parsed_history_postgres'
		});
		expect(repository.findRecentWithLedgerContext).toHaveBeenCalledWith(5);
	});

	it('keeps join readiness false when no parsed transaction rows exist', async () => {
		const repository = createRepository([]);

		await expect(
			new GetExplorerLocalTransactions(repository).execute(10)
		).resolves.toMatchObject({
			count: 0,
			limit: 10,
			readModel: {
				envelopeJoinReady: false,
				ledgerHeaderJoinReady: false,
				parsedTransactionResultsReady: false
			},
			records: []
		});
	});
});

function createRepository(
	rows: Awaited<
		ReturnType<ParsedTransactionResultRepository['findRecentWithLedgerContext']>
	>
): ParsedTransactionResultRepository {
	return {
		findByTransactionHash: jest.fn(),
		findRecentWithLedgerContext: jest.fn().mockResolvedValue(rows),
		saveBatch: jest.fn()
	};
}
