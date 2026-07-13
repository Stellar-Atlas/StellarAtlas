import { parseExplorerLocalReadModel } from '../explorer-local-read-model-contract';

const generatedAt = '2026-07-13T12:00:00.000Z';

describe('explorer local read-model contract', () => {
	it('parses and sanitizes exact canonical watermark evidence', () => {
		const payload = canonicalReadModel();
		const evidence = asRecord(
			asRecord(asRecord(payload.transactions).canonicalCoverage).latestEvidence
		);
		evidence.rawXdr = 'must-not-cross-the-contract';
		asRecord(asRecord(evidence.sourceObjects).ledger).internalPath =
			'/private/archive/file.xdr';

		const parsed = parseExplorerLocalReadModel(payload);

		expect(
			parsed?.transactions.canonicalCoverage?.latestEvidence
		).toMatchObject({
			archiveUrlIdentity: 'archive.example',
			batchId: '00000000-0000-4000-8000-000000000001',
			checkpointLedger: '63386303',
			checkpointProofId: 41,
			sourceObjects: {
				ledger: {
					contentDigest: '22'.repeat(32),
					objectRemoteId: '00000000-0000-4000-8000-000000000003'
				}
			}
		});
		expect(JSON.stringify(parsed)).not.toContain('rawXdr');
		expect(JSON.stringify(parsed)).not.toContain('/private/archive');
	});

	it('rejects uppercase canonical evidence digests', () => {
		const uppercase = canonicalReadModel();
		const uppercaseEvidence = asRecord(
			asRecord(asRecord(uppercase.transactions).canonicalCoverage)
				.latestEvidence
		);
		const sourceObjects = asRecord(uppercaseEvidence.sourceObjects);
		asRecord(sourceObjects.results).contentDigest = 'AA'.repeat(32);
		expect(parseExplorerLocalReadModel(uppercase)).toBeNull();
	});

	it('accepts the previous API contract without inventing provenance', () => {
		const legacy = canonicalReadModel();
		const coverage = asRecord(
			asRecord(legacy.transactions).canonicalCoverage
		);
		delete coverage.latestEvidence;
		delete coverage.source;

		expect(
			parseExplorerLocalReadModel(legacy)?.transactions.canonicalCoverage
				?.latestEvidence
		).toBeNull();
	});

	it.each([
		[
			'last ledger',
			(coverage: Record<string, unknown>) => {
				asRecord(coverage.latestEvidence).lastLedger = '63386302';
			}
		],
		[
			'next ledger',
			(coverage: Record<string, unknown>) => {
				coverage.nextLedger = '63386305';
			}
		],
		[
			'checkpoint ledger',
			(coverage: Record<string, unknown>) => {
				asRecord(coverage.latestEvidence).checkpointLedger = '63386299';
			}
		],
		[
			'transaction result count',
			(coverage: Record<string, unknown>) => {
				coverage.transactionResultCount = 119;
			}
		]
	])('rejects incoherent canonical %s', (_label, mutate) => {
		const payload = canonicalReadModel();
		const coverage = asRecord(asRecord(payload.transactions).canonicalCoverage);
		mutate(coverage);
		expect(parseExplorerLocalReadModel(payload)).toBeNull();
	});

	it('retains the typed fallback contract when no canonical range exists', () => {
		const payload = canonicalReadModel();
		const transactions = asRecord(payload.transactions);
		transactions.canonicalCoverage = null;
		transactions.localCoverage = false;
		transactions.source = 'horizon_fallback';
		payload.source = 'parsed_ledger_header_repository';

		expect(parseExplorerLocalReadModel(payload)).toMatchObject({
			source: 'parsed_ledger_header_repository',
			transactions: {
				canonicalCoverage: null,
				localCoverage: false,
				source: 'horizon_fallback'
			}
		});
	});
});

function canonicalReadModel(): Record<string, unknown> {
	return {
		generatedAt,
		indexes: {
			assetIndexReady: false,
			contractIndexReady: false,
			operationIndexReady: true,
			transactionIndexReady: true
		},
		parsedLedgerHeaders: {
			earliestParsedLedger: null,
			latestObservedAt: null,
			latestParsedLedger: null,
			latestParsedLedgerHash: null,
			parsedLedgerCount: 0,
			sourceArchiveCount: 0
		},
		source: 'full_history_canonical_repository',
		transactions: {
			canonicalCoverage: {
				archiveSourceCount: 1,
				batchCount: 1,
				firstLedger: '63386240',
				lastLedger: '63386303',
				latestEvidence: latestEvidence(),
				latestLedgerClosedAt: generatedAt,
				ledgerCount: 64,
				nextLedger: '63386304',
				rangeKind: 'contiguous_bounded',
				source: 'postgres_canonical',
				transactionCount: 120,
				transactionResultCount: 120,
				updatedAt: generatedAt
			},
			localCoverage: true,
			message: 'Canonical history is available.',
			source: 'postgres_canonical'
		}
	};
}

function latestEvidence() {
	return {
		archiveUrlIdentity: 'archive.example',
		batchId: '00000000-0000-4000-8000-000000000001',
		checkpointLedger: '63386303',
		checkpointProofId: 41,
		decoderVersion: 'canonical-decoder/1',
		firstLedger: '63386240',
		ingestedAt: generatedAt,
		lastLedger: '63386303',
		proofEvaluatedAt: generatedAt,
		proofVersion: 5,
		sourceObjects: {
			checkpointState: sourceObject('11', '2', 'canonical-json'),
			ledger: sourceObject('22', '3', 'uncompressed-xdr'),
			results: sourceObject('33', '5', 'uncompressed-xdr'),
			transactions: sourceObject('44', '4', 'uncompressed-xdr')
		}
	};
}

function sourceObject(
	seed: string,
	suffix: string,
	representation: 'canonical-json' | 'uncompressed-xdr'
) {
	return {
		algorithm: 'sha256',
		contentDigest: seed.repeat(32),
		objectRemoteId: `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`,
		representation
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Expected test fixture record');
	}
	return value as Record<string, unknown>;
}
