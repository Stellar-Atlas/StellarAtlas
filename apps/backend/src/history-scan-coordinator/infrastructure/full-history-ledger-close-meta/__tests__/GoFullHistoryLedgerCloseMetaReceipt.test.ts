import {
	parseGoFullHistoryLedgerCloseMetaManifest,
	parseGoFullHistoryLedgerCloseMetaReceipt,
	processingManifestIdentity
} from '../GoFullHistoryLedgerCloseMetaReceipt.js';

describe('GoFullHistoryLedgerCloseMetaReceipt', () => {
	it('parses aggregate typed output and ordered per-object evidence', () => {
		const value = fixture();
		const receipt = parseGoFullHistoryLedgerCloseMetaReceipt(value);
		const manifest = parseGoFullHistoryLedgerCloseMetaManifest(value);

		expect(receipt).toEqual(
			expect.objectContaining({
				manifestSha256: DIGEST_A,
				range: { endSequence: 4, ledgerCount: 2, startSequence: 3 }
			})
		);
		expect(receipt.sourceObjects).toHaveLength(2);
		expect(receipt.sourceObjects[0]!.range).toEqual({
			endSequence: 3,
			ledgerCount: 1,
			startSequence: 3
		});
		expect(processingManifestIdentity(manifest)).toBe(
			processingManifestIdentity(receipt)
		);
	});

	it('rejects an unsupported dataset instead of silently discarding it', () => {
		const value = fixture();
		value.outputs[0]!.dataset = 'raw-xdr';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/unsupported/i
		);
	});

	it('rejects missing canonical output or a mismatched media type', () => {
		const missing = fixture();
		missing.outputs.shift();
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(missing)).toThrow(
			/incomplete/i
		);

		const mislabeled = fixture();
		mislabeled.outputs[0]!.mediaType = 'application/vnd.apache.parquet';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(mislabeled)).toThrow(
			/incomplete/i
		);

		const misrepresented = fixture();
		misrepresented.outputs[0]!.representation = 'typed-projection';
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaReceipt(misrepresented)
		).toThrow(/incomplete/i);
	});

	it('rejects inconsistent aggregate range evidence', () => {
		const value = fixture();
		value.range.ledgerCount = 3;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/inconsistent/i
		);
	});

	it('rejects a gap between source objects', () => {
		const value = fixture();
		value.sourceObjects[1]!.startLedger = 5;
		value.sourceObjects[1]!.endLedger = 5;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/not contiguous/i
		);
	});

	it('rejects a ledger-hash discontinuity between source objects', () => {
		const value = fixture();
		value.sourceObjects[1]!.firstPreviousLedgerHash = DIGEST_A;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/chain hash/i
		);
	});

	it('rejects an incompatible manifest or output schema version', () => {
		const manifest = fixture();
		manifest.manifestVersion = 'stellar-atlas.full-history-etl.manifest.v5';
		expect(() => parseGoFullHistoryLedgerCloseMetaManifest(manifest)).toThrow(
			/not compatible/i
		);

		const receipt = fixture();
		receipt.outputs[0]!.schemaVersion = 'unrecognized';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(receipt)).toThrow(
			/incomplete/i
		);
	});

	it('accepts immutable v6 manifests while requiring v7 projection schemas', () => {
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(legacyFixture())
		).not.toThrow();

		const mismatched = fixture();
		mismatched.outputs.find(
			(output) => output.dataset === 'contract-events'
		)!.schemaVersion = 'stellar-atlas.full-history.contract-events.v2';
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(mismatched)
		).toThrow(/not compatible/i);
	});
});

function fixture() {
	return {
		format: {
			canonicalLedgerCloseMetaEncoding: 'xdr+zstd',
			name: 'stellar-atlas-full-history-shard',
			parquetCompression: 'zstd',
			parquetWriter: 'github.com/xitongsys/parquet-go@v1.6.2',
			partitionColumns: ['ledger_sequence'],
			stellarSdk: 'github.com/stellar/go-stellar-sdk@v0.6.0',
			stellarXdrCommit: '68fa1ac55692f68ad2a2ca549d0a283273554439'
		},
		inputMediaType:
			'application/x-stellar-ledger-close-meta-batch+xdr+zstd',
		manifestSha256: DIGEST_A,
		manifestStorageKey: `${NETWORK_ID}/ledger-close-meta/3-4/manifest.json`,
		manifestVersion: 'stellar-atlas.full-history-etl.manifest.v7',
		network: {
			name: 'pubnet',
			networkIdSha256: NETWORK_ID
		},
		outputs: DATASETS.map((dataset) => ({
			byteCount: 1_024,
			dataset,
			mediaType:
				dataset === 'ledger-close-meta'
					? 'application/x-stellar-ledger-close-meta-batch+xdr+zstd'
					: 'application/vnd.apache.parquet',
			representation:
				dataset === 'ledger-close-meta'
					? 'lossless-replay'
					: 'typed-projection',
			recordCount:
				dataset === 'ledger-close-meta' ||
				dataset === 'ledgers' ||
				dataset === 'transactions' ||
				dataset === 'transaction-results' ||
				dataset === 'transaction-meta'
					? 2
					: 0,
			schemaVersion: SCHEMA_VERSIONS[dataset],
			sha256: DIGEST_D,
			storageKey: `${NETWORK_ID}/ledger-close-meta/3-4/${dataset}.${dataset === 'ledger-close-meta' ? 'xdr.zst' : 'parquet'}`
		})),
		range: { endLedger: 4, ledgerCount: 2, startLedger: 3 },
		sourceObjects: [
			{
				compressedByteCount: 756,
				compressedSha256: DIGEST_B,
				endLedger: 3,
				firstPreviousLedgerHash: DIGEST_A,
				lastLedgerHash: DIGEST_B,
				ledgerCount: 1,
				objectKey: 'pubnet/ledger-3.xdr.zst',
				startLedger: 3,
				xdrByteCount: 2_604,
				xdrSha256: DIGEST_C
			},
			{
				compressedByteCount: 800,
				compressedSha256: DIGEST_C,
				endLedger: 4,
				firstPreviousLedgerHash: DIGEST_B,
				lastLedgerHash: DIGEST_C,
				ledgerCount: 1,
				objectKey: 'pubnet/ledger-4.xdr.zst',
				startLedger: 4,
				xdrByteCount: 2_700,
				xdrSha256: DIGEST_D
			}
		],
		unsupportedDatasets: [
			'ledger-close-upgrades-and-extension-values',
			'transaction-envelope-details',
			'operation-result-details',
			'effects',
			'accounts',
			'assets',
			'trustlines',
			'offers',
			'liquidity-pools',
			'contracts',
			'contract-data-values',
			'contract-code-values',
			'operation-type-details',
			'transaction-meta-values',
			'ttl-entries',
			'config-settings',
			'restored-keys'
		]
	};
}

function legacyFixture() {
	const value = fixture();
	value.manifestVersion = 'stellar-atlas.full-history-etl.manifest.v6';
	value.outputs.find(
		(output) => output.dataset === 'contract-events'
	)!.schemaVersion = 'stellar-atlas.full-history.contract-events.v2';
	value.outputs.find(
		(output) => output.dataset === 'ledger-entry-changes'
	)!.schemaVersion = 'stellar-atlas.full-history.ledger-entry-changes.v2';
	const operationTypeIndex = value.unsupportedDatasets.indexOf(
		'operation-type-details'
	);
	value.unsupportedDatasets.splice(
		operationTypeIndex,
		0,
		'contract-event-topics-and-data',
		'ledger-entry-keys-and-values'
	);
	return value;
}

const DIGEST_A = '11'.repeat(32);
const DIGEST_B = '22'.repeat(32);
const DIGEST_C = '33'.repeat(32);
const DIGEST_D = '44'.repeat(32);
const NETWORK_ID = '55'.repeat(32);
const DATASETS = [
	'ledger-close-meta',
	'ledgers',
	'transactions',
	'operations',
	'transaction-results',
	'transaction-meta',
	'contract-events',
	'ledger-entry-changes'
] as const;
const SCHEMA_VERSIONS = {
	'contract-events': 'stellar-atlas.full-history.contract-events.v3',
	'ledger-close-meta':
		'stellar-atlas.full-history.ledger-close-meta-batch.v1',
	'ledger-entry-changes':
		'stellar-atlas.full-history.ledger-entry-changes.v3',
	ledgers: 'stellar-atlas.full-history.ledgers.v2',
	operations: 'stellar-atlas.full-history.operations.v2',
	'transaction-meta': 'stellar-atlas.full-history.transaction-meta.v2',
	'transaction-results': 'stellar-atlas.full-history.transaction-results.v2',
	transactions: 'stellar-atlas.full-history.transactions.v2'
} as const;
