import express from 'express';
import request from 'supertest';
import type { FullHistoryOperationQuery } from '@history-scan-coordinator/domain/full-history/FullHistoryCanonicalOperation.js';
import type { ExplorerLocalOperationsDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalOperation.js';
import { createExplorerLocalOperationHandler } from '../ExplorerLocalOperationHandler.js';

const sourceAccount =
	'GCNDNEWL4WBR7DHE3VOVCKVMBB67JMZV3LBXUHPOVEPABEIBVVP5KPIC';
const transactionHash = 'ab'.repeat(32);

describe('ExplorerLocalOperationHandler', () => {
	it('returns only local proof-gated envelope facts for all supported filters', async () => {
		const fetchSpy = jest.spyOn(global, 'fetch');
		const findOperations = jest.fn(
			async (query: FullHistoryOperationQuery): Promise<ExplorerLocalOperationsDTO> =>
				operationPage(query)
		);
		const app = testApp(findOperations);

		await request(app)
			.get(
				`/operations?operationType=payment&firstLedger=64&lastLedger=127&transactionHash=${transactionHash}&sourceAccount=${sourceAccount}&limit=25`
			)
			.expect(200)
			.expect('Cache-Control', 'public, max-age=20')
			.expect((response) => {
				expect(response.body).toMatchObject({
					count: 1,
					coverage: {
						canonicalBatches: 28,
						complete: false,
						indexedBatches: 1
					},
					factBoundary: {
						includes: 'operation_type_and_effective_source',
						outcomes: 'unavailable_without_ledger_close_meta'
					},
					records: [
						{
							factScope: 'operation_body_and_envelope',
							outcomeAvailable: false,
							source: 'postgres_canonical',
							type: 'payment'
						}
					],
					source: 'postgres_canonical'
				});
				expect(response.body.records[0]).not.toHaveProperty('successful');
				expect(response.body.records[0]).not.toHaveProperty('effects');
				expect(response.body.records[0]).not.toHaveProperty('events');
			});

		const query = findOperations.mock.calls[0]?.[0];
		expect(query).toMatchObject({
			firstLedger: '64',
			lastLedger: '127',
			limit: 25,
			operationType: 'payment',
			sourceAccount
		});
		expect(query?.transactionHash?.toHex()).toBe(transactionHash);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it.each([
		'operationType=not_real',
		'firstLedger=128&lastLedger=64',
		'firstLedger=999999999999999999999',
		'sourceAccount=not-an-account',
		'transactionHash=bad',
		'limit=101'
	])('rejects invalid local filters without querying: %s', async (query) => {
		const findOperations = jest.fn(
			async (input: FullHistoryOperationQuery): Promise<ExplorerLocalOperationsDTO> =>
				operationPage(input)
		);
		await request(testApp(findOperations))
			.get(`/operations?${query}`)
			.expect(400)
			.expect({ error: 'Invalid local operation filters' });
		expect(findOperations).not.toHaveBeenCalled();
	});
});

function testApp(
	findOperations: (
		query: FullHistoryOperationQuery
	) => Promise<ExplorerLocalOperationsDTO>
) {
	const app = express();
	app.get(
		'/operations',
		createExplorerLocalOperationHandler({ findOperations })
	);
	return app;
}

function operationPage(
	query: FullHistoryOperationQuery
): ExplorerLocalOperationsDTO {
	return {
		count: 1,
		coverage: {
			canonicalBatches: 28,
			complete: false,
			firstIndexedLedger: '64',
			indexedBatches: 1,
			lastIndexedLedger: '127'
		},
		factBoundary: {
			includes: 'operation_type_and_effective_source',
			outcomes: 'unavailable_without_ledger_close_meta'
		},
		filters: {
			firstLedger: query.firstLedger,
			lastLedger: query.lastLedger,
			operationType: query.operationType,
			sourceAccount: query.sourceAccount,
			transactionHash: query.transactionHash?.toHex()
		},
		generatedAt: '2026-07-12T12:00:00.000Z',
		limit: query.limit,
		records: [
			{
				closedAt: '2026-07-12T11:59:00.000Z',
				evidence: {
					archiveSource: 'archive.example',
					batchId: '00000000-0000-4000-8000-000000000001',
					checkpointLedger: '127',
					checkpointProofId: 1,
					decoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts',
					proofEvaluatedAt: '2026-07-12T11:59:30.000Z',
					proofVersion: 5
				},
				factScope: 'operation_body_and_envelope',
				ledger: '64',
				operationIndex: 0,
				outcomeAvailable: false,
				source: 'postgres_canonical',
				sourceAccount,
				sourceAccountOrigin: 'transaction',
				transactionHash,
				transactionIndex: 0,
				type: 'payment'
			}
		],
		source: 'postgres_canonical',
		truncated: false
	};
}
