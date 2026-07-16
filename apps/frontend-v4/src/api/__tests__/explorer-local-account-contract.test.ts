import { parseExplorerLocalAccountChanges } from '../explorer-local-account-contract';

const accountId = 'GCNDNEWL4WBR7DHE3VOVCKVMBB67JMZV3LBXUHPOVEPABEIBVVP5KPIC';
const generatedAt = '2026-07-12T04:04:00.000Z';

describe('proof-gated account observation contract', () => {
	it('parses and sanitizes a historical account observation', () => {
		const payload = availablePayload();
		const record = firstRecord(payload);
		record.rawStateEntryXdr = 'must-not-cross';
		asRecord(record.provenance).internalPath = '/private/lcm/file';

		const parsed = parseExplorerLocalAccountChanges(payload);

		expect(parsed).toMatchObject({
			accountId,
			interpretation: 'historical_observations_not_current_state',
			source: 'postgres_proof_gated_lcm_account_changes',
			status: 'available'
		});
		expect(JSON.stringify(parsed)).not.toContain('rawStateEntryXdr');
		expect(JSON.stringify(parsed)).not.toContain('/private/lcm');
	});

	it('distinguishes no observation from unavailable canonical coverage', () => {
		const notObserved = availablePayload();
		notObserved.count = 0;
		notObserved.records = [];
		notObserved.reason = 'no_change_observed_in_complete_coverage';
		notObserved.status = 'not_observed';

		const unavailable = availablePayload();
		unavailable.count = 0;
		unavailable.coverage = null;
		unavailable.records = [];
		unavailable.reason = 'complete_canonical_coverage_empty';
		unavailable.status = 'unavailable';

		expect(parseExplorerLocalAccountChanges(notObserved)?.status).toBe(
			'not_observed'
		);
		expect(parseExplorerLocalAccountChanges(unavailable)?.status).toBe(
			'unavailable'
		);
	});

	it('rejects incoherent deletion semantics', () => {
		const payload = availablePayload();
		firstRecord(payload).deleted = true;

		expect(parseExplorerLocalAccountChanges(payload)).toBeNull();
	});

	it('rejects a coverage range whose count does not match its ledgers', () => {
		const payload = availablePayload();
		asRecord(firstRecord(payload).coverage).ledgerCount = 63;

		expect(parseExplorerLocalAccountChanges(payload)).toBeNull();
	});
});

function availablePayload(): MutableRecord {
	return {
		accountId,
		count: 1,
		coverage: latestCoverage(),
		generatedAt,
		interpretation: 'historical_observations_not_current_state',
		limit: 1,
		records: [accountObservation()],
		source: 'postgres_proof_gated_lcm_account_changes',
		status: 'available',
		truncated: false
	};
}

function latestCoverage(): MutableRecord {
	return {
		evidenceSelection: 'latest_complete_canonical_lcm_batch',
		freshness: {
			canonicalCoverageCompletedAt: generatedAt,
			canonicalProofEvaluatedAt: generatedAt,
			latestCoveredLedgerClosedAt: generatedAt
		},
		range: coverageRange()
	};
}

function accountObservation(): MutableRecord {
	return {
		accountFields: {
			accountId,
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
			signers: [{ key: accountId, sponsor: null, weight: 1 }],
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
			transactionHash: 'a'.repeat(64)
		},
		coverage: coverageRange(),
		deleted: false,
		freshness: {
			batchProcessedAt: generatedAt,
			canonicalCoverageCompletedAt: generatedAt,
			canonicalProofEvaluatedAt: generatedAt,
			datasetImportedAt: generatedAt,
			ledgerClosedAt: generatedAt
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
	};
}

function coverageRange(): MutableRecord {
	return {
		batchId: '00000000-0000-4000-8000-000000000002',
		firstLedger: '63386240',
		lastLedger: '63386303',
		ledgerCount: 64
	};
}

type MutableRecord = Record<string, unknown>;

function asRecord(value: unknown): MutableRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError('Expected test fixture record');
	}
	return value as MutableRecord;
}

function firstRecord(payload: MutableRecord): MutableRecord {
	if (!Array.isArray(payload.records) || payload.records.length === 0) {
		throw new TypeError('Expected account observation fixture');
	}
	return asRecord(payload.records[0]);
}
