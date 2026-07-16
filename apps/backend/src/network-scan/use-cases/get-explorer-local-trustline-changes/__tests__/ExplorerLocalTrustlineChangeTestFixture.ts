import { StrKey } from '@stellar/stellar-sdk';
import type { ExplorerLocalTrustlineChangeRawRow } from '../ExplorerLocalTrustlineChangeMapper.js';

export const trustlineAccountId = StrKey.encodeEd25519PublicKey(
	Buffer.alloc(32, 17)
);
export const trustlineAssetIssuer = StrKey.encodeEd25519PublicKey(
	Buffer.alloc(32, 18)
);

export function trustlineObservationRow(
	overrides: Partial<ExplorerLocalTrustlineChangeRawRow> = {}
): ExplorerLocalTrustlineChangeRawRow {
	return {
		accountId: trustlineAccountId,
		assetCode: 'USD',
		assetIssuer: trustlineAssetIssuer,
		assetType: 1,
		assetTypeString: 'ASSET_TYPE_CREDIT_ALPHANUM4',
		balance: '9007199254740995',
		batchId: '00000000-0000-4000-8000-000000000011',
		batchProcessedAt: new Date('2026-07-15T12:01:00.000Z'),
		buyingLiabilities: '9007199254740996',
		canonicalBatchIds: [
			'00000000-0000-4000-8000-000000000012',
			'00000000-0000-4000-8000-000000000013'
		],
		canonicalCoverageCompletedAt: new Date('2026-07-15T12:03:00.000Z'),
		canonicalProofEvaluatedAt: new Date('2026-07-15T12:02:30.000Z'),
		changeIndex: '3',
		changeType: 1,
		changeTypeString: 'LEDGER_ENTRY_UPDATED',
		closedAtUnixMillis: new Date('2026-07-15T12:00:00.000Z')
			.valueOf()
			.toString(),
		coverageFirstLedger: '63390016',
		coverageLastLedger: '63390079',
		coverageLedgerCount: 64,
		datasetImportedAt: new Date('2026-07-15T12:02:00.000Z'),
		datasetImportedRowSetSha256: '1'.repeat(64),
		datasetName: 'trustline-state-changes',
		datasetOutputSha256: '2'.repeat(64),
		datasetRecordCount: '1500',
		datasetSchemaVersion:
			'stellar-atlas.full-history.trustline-state-changes.v1',
		deleted: false,
		flags: '4294967295',
		hasObservation: true,
		lastModifiedLedger: '63390042',
		latestBatchId: '00000000-0000-4000-8000-000000000014',
		latestCoverageCompletedAt: new Date('2026-07-15T13:03:00.000Z'),
		latestFirstLedger: '63390080',
		latestLastLedger: '63390143',
		latestLedgerClosedAt: new Date('2026-07-15T13:00:00.000Z'),
		latestLedgerCount: 64,
		latestProofEvaluatedAt: new Date('2026-07-15T13:02:30.000Z'),
		ledgerKeySha256: '3'.repeat(64),
		ledgerSequence: '63390042',
		limit: '9223372036854775807',
		liquidityPoolId: null,
		liquidityPoolUseCount: '0',
		manifestSha256: '4'.repeat(64),
		minimumProofVersion: 6,
		observationLedgerClosedAt: new Date('2026-07-15T12:00:00.000Z'),
		operationIndex: '2',
		reason: 'operation',
		rowSha256: '5'.repeat(64),
		sellingLiabilities: '9007199254740997',
		sponsor: trustlineAccountId,
		transactionHash: '6'.repeat(64),
		transactionIndex: '9',
		upgradeIndex: null,
		...overrides
	};
}
