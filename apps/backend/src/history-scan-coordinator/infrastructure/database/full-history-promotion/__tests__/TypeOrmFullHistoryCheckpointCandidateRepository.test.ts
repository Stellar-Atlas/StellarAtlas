import { mock } from 'jest-mock-extended';
import type { DataSource, EntityManager } from 'typeorm';
import { CURRENT_HISTORY_ARCHIVE_CHECKPOINT_PROOF_VERSION } from '../../../../domain/history-archive-checkpoint-proof/HistoryArchiveCheckpointProof.js';
import { FullHistoryTransactionObservationsMissingError } from '../../../../domain/full-history-promotion/FullHistoryPromotionError.js';
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
			const candidate = metadataAdmission(
				checkpointLedger,
				observedLedgerCount,
				expectedLedgerCount
			);

			await expect(candidate.load()).rejects.toMatchObject({
				reason: 'parsed-projection-missing',
				diagnostic: {
					checkpointLedger,
					ledgerObjectRemoteId: candidate.ledgerObjectRemoteId,
					expectedLedgerCount,
					observedLedgerCount
				}
			});
			expect(candidate.manager.query).toHaveBeenCalledTimes(4);
			const executedSql = candidate.manager.query.mock.calls.map(([sql]) => sql);
			for (const sql of [
				fullHistoryObservedTransactionBoundsSql,
				fullHistoryObservedEnvelopesSql,
				fullHistoryObservedResultsSql
			])
				expect(executedSql).not.toContain(sql);
		}
	);

	it('classifies actual-like incomplete transaction observations before XDR row reads', async () => {
		const candidate = metadataAdmission(127, 64, 64);
		candidate.manager.query.mockResolvedValueOnce([
			{
				envelopeCount: '1000',
				resultCount: '16767',
				envelopeBytes: '1043240',
				resultBytes: '7742620'
			}
		]);
		const loading = candidate.load();
		await expect(loading).rejects.toBeInstanceOf(
			FullHistoryTransactionObservationsMissingError
		);
		await expect(loading).rejects.toMatchObject({
			reason: 'parsed-projection-missing',
			diagnostic: {
				checkpointLedger: 127,
				ledgerObjectRemoteId: candidate.ledgerObjectRemoteId,
				envelopeCount: '1000',
				resultCount: '16767'
			}
		});
		expect(candidate.manager.query).toHaveBeenCalledTimes(5);
		expect(candidate.manager.query).toHaveBeenNthCalledWith(
			5,
			fullHistoryObservedTransactionBoundsSql,
			[candidate.ledgerObjectRemoteId]
		);
		const executedSql = candidate.manager.query.mock.calls.map(([sql]) => sql);
		expect(executedSql).not.toContain(fullHistoryObservedEnvelopesSql);
		expect(executedSql).not.toContain(fullHistoryObservedResultsSql);
	});

	it.each([
		{
			envelopeCount: '100001',
			resultCount: '16767',
			envelopeBytes: '1043240',
			resultBytes: '7742620'
		},
		{
			envelopeCount: '1000',
			resultCount: '100001',
			envelopeBytes: '1043240',
			resultBytes: '7742620'
		},
		{
			envelopeCount: '1000',
			resultCount: '16767',
			envelopeBytes: '89478488',
			resultBytes: '1'
		}
	])('preserves XDR bounds ahead of mismatched counts: %j', async (bounds) => {
		const candidate = metadataAdmission(127, 64, 64);
		candidate.manager.query.mockResolvedValueOnce([bounds]);
		await expect(candidate.load()).rejects.toMatchObject({
			reason: 'xdr-bound-exceeded'
		});
		expect(candidate.manager.query).toHaveBeenCalledTimes(5);
		expect(candidate.manager.query).toHaveBeenNthCalledWith(
			5,
			fullHistoryObservedTransactionBoundsSql,
			[candidate.ledgerObjectRemoteId]
		);
		const executedSql = candidate.manager.query.mock.calls.map(([sql]) => sql);
		expect(executedSql).not.toContain(fullHistoryObservedEnvelopesSql);
		expect(executedSql).not.toContain(fullHistoryObservedResultsSql);
	});
});

function metadataAdmission(
	checkpointLedger: number,
	observedLedgerCount: number,
	expectedLedgerCount: number
) {
	const target = {
		archiveUrlIdentity: 'https://archive.example',
		checkpointLedger,
		networkPassphrase: 'test-network'
	};
	const objects = ['checkpoint-state', 'ledger', 'transactions', 'results'].map(
		(objectType, index) => ({
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
		})
	);
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
	return {
		manager,
		ledgerObjectRemoteId: objects[1]!.remoteId,
		load: () =>
			new TypeOrmFullHistoryCheckpointCandidateRepository(dataSource).load(target)
	};
}
