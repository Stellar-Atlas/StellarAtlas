import { mock } from 'jest-mock-extended';
import type { EntityManager } from 'typeorm';
import type { FullHistoryCheckpointWrite } from '../../../../domain/full-history/FullHistoryCanonicalBatch.js';
import { FullHistoryCanonicalError } from '../../../../domain/full-history/FullHistoryCanonicalError.js';
import { FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE } from '../../../../domain/full-history/FullHistoryCanonicalOperationResult.js';
import {
	fullHistoryLedgerSequence,
	FullHistoryHash,
	hashNetworkPassphrase
} from '../../../../domain/full-history/FullHistoryCanonicalTypes.js';
import { assertCanonicalOperationResults } from '../FullHistoryCanonicalOperationResultStore.js';

describe('FullHistoryCanonicalOperationResultStore', () => {
	it('verifies expected outcomes in bounded composite-primary-key chunks', async () => {
		const input = checkpointWriteWithOperationResults(501);
		const manager = mock<EntityManager>();
		manager.query.mockImplementation(
			async (sql: string, parameters?: unknown[]) => {
				if (sql.includes('full_history_operation_result_batch_coverage')) {
					return [coverageRow(input)];
				}
				return outcomeRows(parameters ?? []);
			}
		);

		await expect(
			assertCanonicalOperationResults(manager, input)
		).resolves.toBeUndefined();

		const outcomeReads = manager.query.mock.calls.filter(([sql]) =>
			String(sql).includes('from "full_history_operation_result" result')
		);
		expect(outcomeReads).toHaveLength(2);
		expect(outcomeReads.map(([, parameters]) => parameters?.length)).toEqual([
			1_500, 3
		]);
		const networkHash = hashNetworkPassphrase(
			input.networkPassphrase
		).toBuffer();
		for (const [sql, parameters = []] of outcomeReads) {
			const normalized = String(sql).replace(/\s+/g, ' ');
			expect(normalized).toContain(
				'where ( result."network_passphrase_hash", result."transaction_hash", result."operation_index" ) in ('
			);
			expect(normalized).not.toContain('join "full_history_operation"');
			for (let offset = 0; offset < parameters.length; offset += 3) {
				expect(parameters[offset]).toEqual(networkHash);
			}
		}
	});

	it('rejects a missing operation-result row', async () => {
		const input = checkpointWriteWithOperationResults(1);
		const manager = mock<EntityManager>();
		manager.query.mockImplementation(async (sql: string) =>
			sql.includes('full_history_operation_result_batch_coverage')
				? [coverageRow(input)]
				: []
		);

		await expect(
			assertCanonicalOperationResults(manager, input)
		).rejects.toEqual(
			expect.objectContaining<Partial<FullHistoryCanonicalError>>({
				reason: 'canonical-row-conflict'
			})
		);
	});

	it('rejects an operation-result value mismatch', async () => {
		const input = checkpointWriteWithOperationResults(1);
		const manager = mock<EntityManager>();
		manager.query.mockImplementation(
			async (sql: string, parameters?: unknown[]) => {
				if (sql.includes('full_history_operation_result_batch_coverage')) {
					return [coverageRow(input)];
				}
				return outcomeRows(parameters ?? []).map((row) => ({
					...row,
					outcome: 'failed'
				}));
			}
		);

		await expect(
			assertCanonicalOperationResults(manager, input)
		).rejects.toEqual(
			expect.objectContaining<Partial<FullHistoryCanonicalError>>({
				reason: 'canonical-row-conflict'
			})
		);
	});

	it('accepts an empty immutable operation-result batch without a row scan', async () => {
		const input = checkpointWriteWithOperationResults(0);
		const manager = mock<EntityManager>();
		manager.query.mockResolvedValue([coverageRow(input)]);

		await expect(
			assertCanonicalOperationResults(manager, input)
		).resolves.toBeUndefined();
		expect(manager.query).toHaveBeenCalledTimes(1);
		expect(String(manager.query.mock.calls[0]?.[0])).toContain(
			'full_history_operation_result_batch_coverage'
		);
	});

	it('rejects conflicting immutable batch coverage on replay', async () => {
		const input = checkpointWriteWithOperationResults(1);
		const manager = mock<EntityManager>();
		manager.query.mockImplementation(
			async (sql: string, parameters?: unknown[]) => {
				if (sql.includes('full_history_operation_result_batch_coverage')) {
					return [{ ...coverageRow(input), operationCount: 2 }];
				}
				return outcomeRows(parameters ?? []);
			}
		);

		await expect(
			assertCanonicalOperationResults(manager, input)
		).rejects.toEqual(
			expect.objectContaining<Partial<FullHistoryCanonicalError>>({
				reason: 'canonical-row-conflict'
			})
		);
	});
});

function checkpointWriteWithOperationResults(
	count: number
): FullHistoryCheckpointWrite {
	const hash = FullHistoryHash.fromHex('01'.repeat(32));
	const transactionHash = FullHistoryHash.fromHex('02'.repeat(32));
	return {
		archiveUrlIdentity: 'https://archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: fullHistoryLedgerSequence('63'),
		decoderVersion: 'fixture-v1',
		firstLedger: fullHistoryLedgerSequence('1'),
		lastLedger: fullHistoryLedgerSequence('63'),
		ledgers: [],
		networkPassphrase: 'Operation outcome chunk fixture network',
		operationAccountReferenceDecoderVersion: 'fixture-reference-decoder/1',
		operationAccountReferences: [],
		operationDecoderVersion: 'fixture-operation-decoder/1',
		operations: [],
		operationResultDecoderVersion: 'fixture-result-decoder/1',
		operationResults: Array.from({ length: count }, (_, operationIndex) => ({
			factScope: FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
			ledgerSequence: fullHistoryLedgerSequence('1'),
			operationIndex,
			operationResultCode: 0,
			operationSpecificResultCode: 0,
			outcome: 'succeeded' as const,
			transactionHash,
			transactionIndex: 0
		})),
		proofEvaluatedAt: new Date('2026-07-13T00:00:00.000Z'),
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

function coverageRow(input: FullHistoryCheckpointWrite) {
	return {
		factScope: FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
		firstLedger: input.firstLedger,
		lastLedger: input.lastLedger,
		operationCount: input.operationResults.length,
		resultDecoderVersion: input.operationResultDecoderVersion
	};
}

function outcomeRows(parameters: readonly unknown[]): Array<{
	readonly factScope: string;
	readonly operationIndex: unknown;
	readonly operationResultCode: number;
	readonly operationSpecificResultCode: number;
	readonly outcome: string;
	readonly transactionHash: unknown;
}> {
	const rows = [];
	for (let offset = 0; offset < parameters.length; offset += 3) {
		rows.push({
			factScope: FULL_HISTORY_OPERATION_RESULT_FACT_SCOPE,
			operationIndex: parameters[offset + 2],
			operationResultCode: 0,
			operationSpecificResultCode: 0,
			outcome: 'succeeded',
			transactionHash: parameters[offset + 1]
		});
	}
	return rows;
}
