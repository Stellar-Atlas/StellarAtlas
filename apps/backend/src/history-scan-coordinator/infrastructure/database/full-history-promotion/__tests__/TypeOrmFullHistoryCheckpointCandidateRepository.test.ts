import { mock } from 'jest-mock-extended';
import type { DataSource, EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import {
	fullHistoryObservedEnvelopesSql,
	fullHistoryObservedResultsSql,
	fullHistoryObservedTransactionBoundsSql
} from '../FullHistoryCandidateSql.js';
import { TypeOrmFullHistoryCheckpointCandidateRepository } from '../TypeOrmFullHistoryCheckpointCandidateRepository.js';

describe('checkpoint candidate metadata admission', () => {
	it.each([
		[63, 0, 63],
		[63, 62, 63],
		[127, 0, 64],
		[127, 63, 64],
		[127, 65, 64]
	])(
		'rejects checkpoint %i with %i observations before transaction reads',
		async (checkpointLedger, observedLedgerCount, expectedLedgerCount) => {
			const target = {
				archiveUrlIdentity: 'https://archive.example',
				checkpointLedger,
				networkPassphrase: 'test-network'
			};
			const objects = [
				'checkpoint-state',
				'ledger',
				'transactions',
				'results'
			].map((objectType, index) => ({
				...target,
				remoteId: `00000000-0000-4000-8000-00000000000${index + 1}`,
				objectType,
				status: 'verified',
				verificationFacts: {
					content: {
						algorithm: 'sha256',
						digest: '00'.repeat(32),
						representation:
							objectType === 'checkpoint-state'
								? 'canonical-json'
								: 'uncompressed-xdr'
					}
				}
			}));
			const manager = mock<EntityManager>();
			manager.query
				.mockRejectedValue(new Error('Unexpected transaction data read'))
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([
					{
						...target,
						id: 1,
						status: 'verified',
						proofVersion: CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION,
						failureKind: null,
						requiredObjectsComplete: true,
						proofFactsComplete: true,
						checkpointBucketListMatches: true,
						transactionsMatch: true,
						resultsMatch: true,
						previousLedgersMatch: true,
						bucketsVerified: true,
						ledgerFactCount: expectedLedgerCount,
						transactionFactCount: expectedLedgerCount,
						resultFactCount: expectedLedgerCount,
						details: {
							networkPassphrase: target.networkPassphrase,
							checkpointStateLedgerFactPresent: true,
							checkpointStateLedgerMatches: true
						},
						checkpointStateObjectRemoteId: objects[0]!.remoteId,
						ledgerObjectRemoteId: objects[1]!.remoteId,
						transactionsObjectRemoteId: objects[2]!.remoteId,
						resultsObjectRemoteId: objects[3]!.remoteId
					}
				])
				.mockResolvedValueOnce(objects)
				.mockResolvedValueOnce(
					Array.from({ length: observedLedgerCount }, () => ({}))
				);
			const dataSource = mock<DataSource>();
			dataSource.transaction.mockImplementation(async (_isolation, run) =>
				run(manager)
			);

			await expect(
				new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource).load(
					target
				)
			).rejects.toMatchObject({
				reason: 'candidate-incomplete',
				diagnostic: {
					checkpointLedger,
					ledgerObjectRemoteId: objects[1]!.remoteId,
					expectedLedgerCount,
					observedLedgerCount
				}
			});
			expect(manager.query).toHaveBeenCalledTimes(4);
			const executedSql = manager.query.mock.calls.map(([sql]) => sql);
			for (const sql of [
				fullHistoryObservedTransactionBoundsSql,
				fullHistoryObservedEnvelopesSql,
				fullHistoryObservedResultsSql
			])
				expect(executedSql).not.toContain(sql);
		}
	);
});
