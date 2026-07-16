/// <reference types="jest" />

import { renderToStaticMarkup } from 'react-dom/server';
import type { PublicExplorerLocalAccountChanges } from '@api/types';
import { formatDate } from '../blockchain-explorer-format';
import { ExplorerAccountObservation } from '../explorer-account-observation';

type AvailableChanges = Extract<
	PublicExplorerLocalAccountChanges,
	{ readonly status: 'available' }
>;
type NotObservedChanges = Extract<
	PublicExplorerLocalAccountChanges,
	{ readonly status: 'not_observed' }
>;
type UnavailableChanges = Extract<
	PublicExplorerLocalAccountChanges,
	{ readonly status: 'unavailable' }
>;

const accountId = `G${'A'.repeat(55)}`;
const observationBatchId = '00000000-0000-4000-8000-000000000003';
const coverageBatchId = '00000000-0000-4000-8000-000000000004';

describe('explorer account observation', () => {
	it('renders unavailable as missing complete proof-gated coverage', () => {
		const html = render(unavailableChanges());

		expect(html).toContain(
			'No complete proof-gated coverage is available for account changes'
		);
		expect(html).toContain('no historical observation can be reported');
	});

	it('renders not observed within its bounded coverage without proving absence', () => {
		const html = render(notObservedChanges());

		expect(html).toContain(
			'No account change observed in covered ledgers 63390080 to 63390143'
		);
		expect(html).toContain(
			'This does not prove the account was absent; it only means no account change was indexed in that covered interval'
		);
		expect(html).toContain('63390080 to 63390143 (64 ledgers)');
		expect(html).toContain(formatDate('2026-07-15T12:02:00.000Z'));
		expect(html).toContain(coverageBatchId);
	});

	it('renders the newest deleted historical observation and its proof provenance', () => {
		const html = render(availableChanges());

		expect(html).toContain('Newest proof-gated historical account observation');
		expect(html).toContain(accountId);
		expect(html).toContain('9876543210 stroops');
		expect(html).toContain('<dt>Sequence at observation</dt><dd>714</dd>');
		expect(html).toContain('<dt>Subentries at observation</dt><dd>4</dd>');
		expect(html).toContain('<dt>Signer count at observation</dt><dd>2</dd>');
		expect(html).toContain('<dt>Observed ledger</dt><dd>63390042</dd>');
		expect(html).toContain(formatDate('2026-07-15T12:00:00.000Z'));
		expect(html).toContain('63390080 to 63390143 (64 ledgers)');
		expect(html).toContain(formatDate('2026-07-15T12:02:00.000Z'));
		expect(html).toContain(formatDate('2026-07-15T12:03:00.000Z'));
		expect(html).toContain('Deleted in this observed change');
		expect(html).toContain('Final pre-deletion state');
		expect(html).toContain('Minimum v6');
		expect(html).toContain(observationBatchId);
	});

	it('never labels historical evidence as current account state', () => {
		const pages = [
			render(unavailableChanges()),
			render(notObservedChanges()),
			render(availableChanges())
		];

		for (const html of pages) {
			expect(html).not.toContain('<dt>Current');
			expect(html).not.toMatch(
				/\bcurrent account (?:balance|sequence|state)\b/iu
			);
			expect(html).not.toMatch(/\blive account (?:balance|sequence|state)\b/iu);
		}
	});
});

function render(changes: PublicExplorerLocalAccountChanges): string {
	return renderToStaticMarkup(<ExplorerAccountObservation account={changes} />);
}

function unavailableChanges(): UnavailableChanges {
	return {
		...baseChanges(),
		coverage: null,
		reason: 'complete_canonical_coverage_empty',
		status: 'unavailable'
	};
}

function notObservedChanges(): NotObservedChanges {
	return {
		...baseChanges(),
		coverage: latestCoverage(),
		reason: 'no_change_observed_in_complete_coverage',
		status: 'not_observed'
	};
}

function availableChanges(): AvailableChanges {
	return {
		...baseChanges(),
		count: 1,
		coverage: latestCoverage(),
		records: [
			{
				accountFields: {
					accountId,
					balance: '9876543210',
					buyingLiabilities: '0',
					flags: '0',
					highThreshold: 2,
					homeDomain: 'example.org',
					inflationDestination: null,
					lowThreshold: 1,
					masterWeight: 1,
					mediumThreshold: 2,
					sequenceLedger: '63390042',
					sequenceNumber: '714',
					sequenceTime: '1784116800',
					signers: [
						{ key: accountId, sponsor: null, weight: 1 },
						{
							key: `G${'B'.repeat(55)}`,
							sponsor: accountId,
							weight: 2
						}
					],
					sellingLiabilities: '0',
					sponsoredEntryCount: '1',
					sponsoringEntryCount: '0',
					subentryCount: '4'
				},
				change: {
					changeType: 2,
					changeTypeString: 'state',
					lastModifiedLedger: '63390042',
					reason: 'operation',
					sponsor: null,
					transactionHash: '6'.repeat(64)
				},
				coverage: {
					batchId: observationBatchId,
					firstLedger: '63390016',
					lastLedger: '63390079',
					ledgerCount: 64
				},
				deleted: true,
				freshness: {
					batchProcessedAt: '2026-07-15T12:00:30.000Z',
					canonicalCoverageCompletedAt: '2026-07-15T12:01:00.000Z',
					canonicalProofEvaluatedAt: '2026-07-15T12:00:45.000Z',
					datasetImportedAt: '2026-07-15T12:00:40.000Z',
					ledgerClosedAt: '2026-07-15T12:00:00.000Z'
				},
				position: {
					changeIndex: '3',
					ledgerSequence: '63390042',
					operationIndex: '0',
					transactionIndex: '9',
					upgradeIndex: null
				},
				provenance: {
					batch: { id: observationBatchId },
					dataset: {
						importedRowSetSha256: '1'.repeat(64),
						name: 'account-state-changes',
						outputSha256: '2'.repeat(64),
						recordCount: '8',
						schemaVersion: '1'
					},
					manifest: { sha256: '3'.repeat(64) },
					proof: {
						canonicalBatchIds: [
							'00000000-0000-4000-8000-000000000001',
							'00000000-0000-4000-8000-000000000002'
						],
						minimumVersion: 6
					},
					row: {
						ledgerKeySha256: '4'.repeat(64),
						sha256: '5'.repeat(64)
					}
				},
				stateSemantics: 'final_pre_deletion_state'
			}
		],
		status: 'available'
	};
}

function latestCoverage(): AvailableChanges['coverage'] {
	return {
		evidenceSelection: 'latest_complete_canonical_lcm_batch',
		freshness: {
			canonicalCoverageCompletedAt: '2026-07-15T12:03:00.000Z',
			canonicalProofEvaluatedAt: '2026-07-15T12:02:30.000Z',
			latestCoveredLedgerClosedAt: '2026-07-15T12:02:00.000Z'
		},
		range: {
			batchId: coverageBatchId,
			firstLedger: '63390080',
			lastLedger: '63390143',
			ledgerCount: 64
		}
	};
}

function baseChanges() {
	return {
		accountId,
		count: 0,
		generatedAt: '2026-07-15T12:04:00.000Z',
		interpretation: 'historical_observations_not_current_state' as const,
		limit: 1,
		records: [],
		source: 'postgres_proof_gated_lcm_account_changes' as const,
		truncated: false
	};
}
