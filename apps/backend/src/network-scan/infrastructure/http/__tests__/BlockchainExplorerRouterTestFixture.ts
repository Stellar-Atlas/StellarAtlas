import express from 'express';
import type { ExplorerLocalReadModelDTO } from '../../../use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import type { ExplorerLocalTransactionsDTO } from '../../../use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import type { ExplorerLocalOperationsDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalOperation.js';
import type { ExplorerCanonicalTransactionDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalTransaction.js';
import {
	blockchainExplorerRouter,
	createExplorerTransactionLookupHandler
} from '../BlockchainExplorerRouter.js';

interface BuildTestAppOptions {
	readonly localFeed?: ExplorerLocalTransactionsDTO;
	readonly localTransaction?: ExplorerCanonicalTransactionDTO | null;
}

export const canonicalHash = 'a'.repeat(64);
export const canonicalSourceAccount =
	'GCNDNEWL4WBR7DHE3VOVCKVMBB67JMZV3LBXUHPOVEPABEIBVVP5KPIC';

const canonicalTransaction: ExplorerCanonicalTransactionDTO = {
	createdAt: '2026-07-08T16:09:36.000Z',
	feeCharged: '100',
	hash: canonicalHash,
	ledger: '63386303',
	operationCount: 3,
	source: 'postgres_canonical',
	sourceAccount: canonicalSourceAccount,
	successful: true
};

export const canonicalOperation: ExplorerLocalOperationsDTO['records'][number] =
	{
		createdAt: '2026-07-08T16:09:36.000Z',
		evidence: {
			archiveSource: 'archive.example',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: '63386303',
			checkpointProofId: 41,
			decoderVersion: 'stellar-sdk-16/archive-xdr-v2-operation-facts',
			proofEvaluatedAt: '2026-07-08T16:10:00.000Z',
			proofVersion: 5
		},
		factScope: 'operation_body_and_envelope',
		id: `${canonicalHash}:0`,
		ledger: '63386303',
		operationIndex: 0,
		operationResultCode: 0,
		operationSpecificResultCode: 0,
		outcome: 'succeeded',
		outcomeAvailable: true,
		outcomeEvidence: {
			decoderVersion:
				'stellar-sdk-16/transaction-result-xdr-v1-operation-results',
			factScope: 'transaction_result_xdr'
		},
		source: 'postgres_canonical',
		sourceAccount: canonicalSourceAccount,
		sourceAccountOrigin: 'transaction',
		transactionHash: canonicalHash,
		transactionIndex: 0,
		type: 'payment'
	};

const canonicalCoverage = {
	archiveSourceCount: 1,
	batchCount: 1,
	firstLedger: '63386240',
	lastLedger: '63386303',
	latestLedgerClosedAt: '2026-07-08T16:09:36.000Z',
	ledgerCount: 64,
	nextLedger: '63386304',
	rangeKind: 'contiguous_bounded' as const,
	transactionCount: 26158,
	transactionResultCount: 26158,
	updatedAt: '2026-07-12T03:19:10.000Z'
};

export const canonicalFeed = (
	records: readonly ExplorerCanonicalTransactionDTO[] = [canonicalTransaction]
): ExplorerLocalTransactionsDTO => ({
	canonicalCoverage: records.length > 0 ? canonicalCoverage : null,
	count: records.length,
	generatedAt: '2026-07-12T04:00:00.000Z',
	limit: 20,
	readModel: {
		assetIndexReady: false,
		contractIndexReady: false,
		evidenceSelection: 'proof_gated_canonical_transaction_and_result',
		operationIndexReady: true,
		transactionIndexReady: records.length > 0
	},
	records,
	source: 'postgres_canonical',
	truncated: records.length > 0
});

export function buildTestApp(options: BuildTestAppOptions = {}) {
	const app = express();
	const getExplorerLocalTransactions = {
		execute: async (limit: number) => ({
			...(options.localFeed ?? canonicalFeed()),
			limit
		}),
		findByHash: async () =>
			options.localTransaction === undefined
				? canonicalTransaction
				: options.localTransaction,
		findOperations: async (): Promise<ExplorerLocalOperationsDTO> => ({
			count: 1,
			coverage: {
				canonicalBatches: 1,
				complete: true,
				firstIndexedLedger: '63386240',
				firstOutcomeIndexedLedger: '63386240',
				indexedBatches: 1,
				lastIndexedLedger: '63386303',
				lastOutcomeIndexedLedger: '63386303',
				outcomeIndexedBatches: 1,
				outcomesComplete: true
			},
			factBoundary: {
				includes: 'operation_type_and_effective_source',
				outcomes: 'transaction_result_xdr_when_indexed'
			},
			filters: {},
			generatedAt: '2026-07-12T04:00:00.000Z',
			limit: 50,
			records: [canonicalOperation],
			source: 'postgres_canonical',
			truncated: false
		})
	};
	app.get(
		'/v1/transactions/:hash',
		createExplorerTransactionLookupHandler({
			getExplorerLocalTransactions,
			horizonUrl: 'https://horizon.example'
		})
	);
	app.use(
		'/v1/explorer',
		blockchainExplorerRouter({
			getExplorerLocalReadModel: {
				execute: async () => localReadModel()
			},
			getExplorerLocalTransactions,
			horizonUrl: 'https://horizon.example'
		})
	);
	return app;
}

function localReadModel(): ExplorerLocalReadModelDTO {
	return {
		generatedAt: '2026-07-12T04:00:00.000Z',
		indexes: {
			assetIndexReady: false,
			contractIndexReady: false,
			operationIndexReady: true,
			transactionIndexReady: true
		},
		parsedLedgerHeaders: {
			earliestParsedLedger: '64',
			latestObservedAt: '2026-07-06T00:00:00.000Z',
			latestParsedLedger: '128',
			latestParsedLedgerHash: 'hash-128',
			parsedLedgerCount: 2,
			sourceArchiveCount: 1
		},
		source: 'parsed_ledger_header_repository',
		transactions: {
			canonicalCoverage,
			localCoverage: true,
			message:
				'Transactions are available from the bounded proof-gated canonical range.',
			source: 'postgres_canonical'
		}
	};
}
