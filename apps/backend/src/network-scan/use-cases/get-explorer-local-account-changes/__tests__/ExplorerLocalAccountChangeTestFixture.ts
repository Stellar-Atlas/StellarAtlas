import { StrKey } from '@stellar/stellar-sdk';
import type { ExplorerLocalAccountChangeRawRow } from '../ExplorerLocalAccountChangeMapper.js';

export const accountId = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));

export function accountObservationRow(
	overrides: Partial<ExplorerLocalAccountChangeRawRow> = {}
): ExplorerLocalAccountChangeRawRow {
	return {
		accountId,
		balance: '9876543210',
		batchId: '00000000-0000-4000-8000-000000000001',
		batchProcessedAt: new Date('2026-07-15T12:01:00.000Z'),
		buyingLiabilities: '11',
		canonicalBatchIds: [
			'00000000-0000-4000-8000-000000000002',
			'00000000-0000-4000-8000-000000000003'
		],
		canonicalCoverageCompletedAt: new Date('2026-07-15T12:03:00.000Z'),
		canonicalProofEvaluatedAt: new Date('2026-07-15T12:02:30.000Z'),
		changeIndex: '3',
		changeType: 1,
		changeTypeString: 'updated',
		closedAtUnixMillis: new Date('2026-07-15T12:00:00.000Z')
			.valueOf()
			.toString(),
		coverageFirstLedger: '63390016',
		coverageLastLedger: '63390079',
		coverageLedgerCount: 64,
		datasetImportedAt: new Date('2026-07-15T12:02:00.000Z'),
		datasetImportedRowSetSha256: '1'.repeat(64),
		datasetName: 'account-state-changes',
		datasetOutputSha256: '2'.repeat(64),
		datasetRecordCount: '1500',
		datasetSchemaVersion: 'stellar-etl/account-state-change/v1',
		deleted: false,
		flags: '4',
		hasObservation: true,
		highThreshold: 3,
		homeDomain: 'example.org',
		inflationDestination: null,
		lastModifiedLedger: '63390042',
		latestBatchId: '00000000-0000-4000-8000-000000000004',
		latestCoverageCompletedAt: new Date('2026-07-15T13:03:00.000Z'),
		latestFirstLedger: '63390080',
		latestLastLedger: '63390143',
		latestLedgerClosedAt: new Date('2026-07-15T13:00:00.000Z'),
		latestLedgerCount: 64,
		latestProofEvaluatedAt: new Date('2026-07-15T13:02:30.000Z'),
		ledgerKeySha256: '3'.repeat(64),
		ledgerSequence: '63390042',
		lowThreshold: 1,
		manifestSha256: '4'.repeat(64),
		masterWeight: 1,
		mediumThreshold: 2,
		minimumProofVersion: 6,
		observationLedgerClosedAt: new Date('2026-07-15T12:00:00.000Z'),
		operationIndex: '2',
		reason: 'operation',
		rowSha256: '5'.repeat(64),
		sellingLiabilities: '12',
		sequenceLedger: '63390040',
		sequenceNumber: '456789012345',
		sequenceTime: '1784116800',
		signerCount: '2',
		signerKeys: ['G-SIGNER-ONE', 'G-SIGNER-TWO'],
		signerSponsors: [null, accountId],
		signerWeights: [1, 2],
		sponsor: accountId,
		sponsoredEntryCount: '5',
		sponsoringEntryCount: '6',
		subentryCount: '7',
		transactionHash: '6'.repeat(64),
		transactionIndex: '9',
		upgradeIndex: null,
		...overrides
	};
}
