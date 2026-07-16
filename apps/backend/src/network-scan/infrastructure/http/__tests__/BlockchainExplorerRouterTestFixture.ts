import express from 'express';
import type { ExplorerLocalReadModelDTO } from '../../../use-cases/get-explorer-local-read-model/GetExplorerLocalReadModel.js';
import type { ExplorerLocalTransactionsDTO } from '../../../use-cases/get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import type { ExplorerLocalOperationsDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalOperation.js';
import type { ExplorerCanonicalTransactionDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalTransaction.js';
import type { ExplorerCanonicalLedgerDTO } from '../../../use-cases/get-explorer-local-transactions/ExplorerCanonicalLedger.js';
import type { ExplorerLocalAccountChangesDTO } from '../../../use-cases/get-explorer-local-account-changes/ExplorerLocalAccountChangeDTO.js';
import {
	blockchainExplorerRouter,
	createExplorerTransactionLookupHandler
} from '../BlockchainExplorerRouter.js';

interface BuildTestAppOptions {
	readonly localAccountChanges?: ExplorerLocalAccountChangesDTO;
	readonly localFeed?: ExplorerLocalTransactionsDTO;
	readonly localLedger?: ExplorerCanonicalLedgerDTO | null;
	readonly localTransaction?: ExplorerCanonicalTransactionDTO | null;
}

export const canonicalHash = 'a'.repeat(64);
export const canonicalSourceAccount =
	'GCNDNEWL4WBR7DHE3VOVCKVMBB67JMZV3LBXUHPOVEPABEIBVVP5KPIC';

export const canonicalAccountObservation: ExplorerLocalAccountChangesDTO = {
	accountId: canonicalSourceAccount,
	count: 1,
	coverage: {
		evidenceSelection: 'latest_complete_canonical_lcm_batch',
		freshness: {
			canonicalCoverageCompletedAt: '2026-07-12T04:03:00.000Z',
			canonicalProofEvaluatedAt: '2026-07-12T04:02:00.000Z',
			latestCoveredLedgerClosedAt: '2026-07-12T04:00:00.000Z'
		},
		range: {
			batchId: '00000000-0000-4000-8000-000000000002',
			firstLedger: '63386240',
			lastLedger: '63386303',
			ledgerCount: 64
		}
	},
	generatedAt: '2026-07-12T04:04:00.000Z',
	interpretation: 'historical_observations_not_current_state',
	limit: 1,
	records: [
		{
			accountFields: {
				accountId: canonicalSourceAccount,
				balance: '1000000000',
				buyingLiabilities: '0',
				flags: '0',
				highThreshold: 2,
				homeDomain: 'example.org',
				inflationDestination: null,
				lowThreshold: 1,
				masterWeight: 1,
				mediumThreshold: 2,
				sequenceLedger: null,
				sequenceNumber: '123',
				sequenceTime: null,
				signers: [{ key: canonicalSourceAccount, sponsor: null, weight: 1 }],
				sellingLiabilities: '0',
				sponsoredEntryCount: '0',
				sponsoringEntryCount: '0',
				subentryCount: '1'
			},
			change: {
				changeType: 1,
				changeTypeString: 'state',
				lastModifiedLedger: '63386303',
				reason: 'operation',
				sponsor: null,
				transactionHash: canonicalHash
			},
			coverage: {
				batchId: '00000000-0000-4000-8000-000000000002',
				firstLedger: '63386240',
				lastLedger: '63386303',
				ledgerCount: 64
			},
			deleted: false,
			freshness: {
				batchProcessedAt: '2026-07-12T04:01:00.000Z',
				canonicalCoverageCompletedAt: '2026-07-12T04:03:00.000Z',
				canonicalProofEvaluatedAt: '2026-07-12T04:02:00.000Z',
				datasetImportedAt: '2026-07-12T04:01:30.000Z',
				ledgerClosedAt: '2026-07-12T04:00:00.000Z'
			},
			position: {
				changeIndex: '0',
				ledgerSequence: '63386303',
				operationIndex: '0',
				transactionIndex: '0',
				upgradeIndex: null
			},
			provenance: {
				batch: { id: '00000000-0000-4000-8000-000000000002' },
				dataset: {
					importedRowSetSha256: '1'.repeat(64),
					name: 'account-state-changes',
					outputSha256: '2'.repeat(64),
					recordCount: '1',
					schemaVersion: '1'
				},
				manifest: { sha256: '3'.repeat(64) },
				proof: {
					canonicalBatchIds: ['00000000-0000-4000-8000-000000000001'],
					minimumVersion: 6
				},
				row: {
					ledgerKeySha256: '4'.repeat(64),
					sha256: '5'.repeat(64)
				}
			},
			stateSemantics: 'observed_post_change_state'
		}
	],
	source: 'postgres_proof_gated_lcm_account_changes',
	status: 'available',
	truncated: false
};

export const canonicalLedger: ExplorerCanonicalLedgerDTO = {
	closedAt: '2026-07-08T16:09:36.000Z',
	hash: 'd'.repeat(64),
	operationCount: 27,
	protocolVersion: 27,
	sequence: '63386303',
	source: 'postgres_canonical',
	transactionCount: 11
};

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
		accountReferences: [
			{
				accountId: canonicalSourceAccount,
				baseAccountId: canonicalSourceAccount,
				role: 'effective_source'
			}
		],
		createdAt: '2026-07-08T16:09:36.000Z',
		evidence: {
			accountReferenceDecoderVersion:
				'stellar-sdk-16/archive-xdr-v1-operation-account-references',
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
	latestEvidence: {
		archiveUrlIdentity: 'archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: '63386303',
		checkpointProofId: 41,
		decoderVersion: 'canonical-decoder/1',
		firstLedger: '63386240',
		ingestedAt: '2026-07-08T16:11:00.000Z',
		lastLedger: '63386303',
		proofEvaluatedAt: '2026-07-08T16:10:00.000Z',
		proofVersion: 5,
		sourceObjects: {
			checkpointState: sourceObjectEvidence('11', '2', 'canonical-json'),
			ledger: sourceObjectEvidence('22', '3', 'uncompressed-xdr'),
			results: sourceObjectEvidence('33', '5', 'uncompressed-xdr'),
			transactions: sourceObjectEvidence('44', '4', 'uncompressed-xdr')
		}
	},
	latestLedgerClosedAt: '2026-07-08T16:09:36.000Z',
	ledgerCount: 64,
	nextLedger: '63386304',
	rangeKind: 'contiguous_bounded' as const,
	source: 'postgres_canonical' as const,
	transactionCount: 26158,
	transactionResultCount: 26158,
	updatedAt: '2026-07-12T03:19:10.000Z'
};

function sourceObjectEvidence(
	seed: string,
	suffix: string,
	representation: 'canonical-json' | 'uncompressed-xdr'
) {
	return {
		algorithm: 'sha256' as const,
		contentDigest: seed.repeat(32),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
		representation
	};
}

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
		findLedger: async () =>
			options.localLedger === undefined ? canonicalLedger : options.localLedger,
		findOperations: async (): Promise<ExplorerLocalOperationsDTO> => ({
			count: 1,
			coverage: {
				accountReferenceIndexedBatches: 1,
				accountReferencesComplete: true,
				canonicalBatches: 1,
				complete: true,
				firstAccountReferenceIndexedLedger: '63386240',
				firstIndexedLedger: '63386240',
				firstOutcomeIndexedLedger: '63386240',
				indexedBatches: 1,
				lastAccountReferenceIndexedLedger: '63386303',
				lastIndexedLedger: '63386303',
				lastOutcomeIndexedLedger: '63386303',
				outcomeIndexedBatches: 1,
				operationFactsComplete: true,
				outcomesComplete: true
			},
			factBoundary: {
				excludes: 'state_effects_soroban_auth_signers_and_asset_issuers',
				includes:
					'operation_type_effective_source_and_explicit_envelope_account_references',
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
	const getExplorerLocalAccountChanges = {
		execute: async () =>
			options.localAccountChanges ?? canonicalAccountObservation
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
			getExplorerLocalAccountChanges,
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
