import type { EntityManager } from 'typeorm';
import { mock } from 'jest-mock-extended';
import type { FullHistoryCheckpointWrite } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash,
	hashNetworkPassphrase
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import {
	assertOperationBackfillBaseFacts,
	FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL
} from '../FullHistoryOperationBackfillBaseFactValidator.js';

describe('FullHistoryOperationBackfillBaseFactValidator', () => {
	it('bounds the previously timing-out result lookup by indexed network and ledger range', async () => {
		const manager = mock<EntityManager>();
		manager.query.mockImplementation(async (sql: string) => {
			if (sql.includes('full_history_transaction_result')) {
				if (
					!sql.includes('"network_passphrase_hash" = $2') ||
					!sql.includes('"ledger_sequence" between $3 and $4')
				) {
					throw new Error('canceling statement due to statement timeout');
				}
			}
			return [];
		});
		const input = emptyCheckpointWrite();

		await expect(
			assertOperationBackfillBaseFacts(
				manager,
				input,
				hashNetworkPassphrase(input.networkPassphrase)
			)
		).resolves.toBeUndefined();
		expect(FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL).toContain(
			'"network_passphrase_hash" = $2'
		);
		expect(FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL).toContain(
			'"ledger_sequence" between $3 and $4'
		);
		expect(manager.query).toHaveBeenLastCalledWith(
			FULL_HISTORY_OPERATION_BACKFILL_RESULT_FACTS_SQL,
			[
				input.batchId,
				hashNetworkPassphrase(input.networkPassphrase).toBuffer(),
				input.firstLedger,
				input.lastLedger
			]
		);
	});
});

function emptyCheckpointWrite(): FullHistoryCheckpointWrite {
	const hash = FullHistoryHash.fromHex('01'.repeat(32));
	return {
		archiveUrlIdentity: 'https://archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: fullHistoryLedgerSequence('63'),
		decoderVersion: 'fixture-v1',
		firstLedger: fullHistoryLedgerSequence('1'),
		lastLedger: fullHistoryLedgerSequence('63'),
		ledgers: [],
		networkPassphrase: 'Base fact validator fixture network',
		operations: [],
		proofEvaluatedAt: new Date('2026-07-12T00:00:00.000Z'),
		proofId: 1,
		proofVersion: 1,
		results: [],
		sources: {
			checkpointState: {
				contentDigest: hash,
				remoteId: '00000000-0000-4000-8000-000000000011'
			},
			ledger: {
				contentDigest: hash,
				remoteId: '00000000-0000-4000-8000-000000000012'
			},
			results: {
				contentDigest: hash,
				remoteId: '00000000-0000-4000-8000-000000000013'
			},
			transactions: {
				contentDigest: hash,
				remoteId: '00000000-0000-4000-8000-000000000014'
			}
		},
		transactions: []
	};
}
