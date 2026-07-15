import {
	parseGoFullHistoryLedgerCloseMetaManifest,
	parseGoFullHistoryLedgerCloseMetaReceipt,
	processingManifestIdentity
} from '../GoFullHistoryLedgerCloseMetaReceipt.js';

describe('GoFullHistoryLedgerCloseMetaReceipt', () => {
	it('parses aggregate typed output and ordered per-object evidence', () => {
		const receipt = parseGoFullHistoryLedgerCloseMetaReceipt(receiptFixture());
		const manifest =
			parseGoFullHistoryLedgerCloseMetaManifest(manifestFixture());

		expect(receipt).toEqual(
			expect.objectContaining({
				manifestSha256: DIGEST_A,
				range: { endSequence: 4, ledgerCount: 2, startSequence: 3 }
			})
		);
		expect(manifest.createdAt).toBe('2026-07-15T16:01:02.123456789Z');
		expect(manifest.limits).toEqual(
			expect.objectContaining({ maxLedgers: 1_024, maxRows: 10_000 })
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
		const value = receiptFixture();
		value.outputs[0]!.dataset = 'raw-xdr';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/unsupported/i
		);
	});

	it('rejects missing canonical output or a mismatched media type', () => {
		const missing = receiptFixture();
		missing.outputs.shift();
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(missing)).toThrow(
			/incomplete/i
		);

		const mislabeled = receiptFixture();
		mislabeled.outputs[0]!.mediaType = 'application/vnd.apache.parquet';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(mislabeled)).toThrow(
			/incomplete/i
		);

		const misrepresented = receiptFixture();
		misrepresented.outputs[0]!.representation = 'typed-projection';
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaReceipt(misrepresented)
		).toThrow(/incomplete/i);
	});

	it('rejects inconsistent aggregate range evidence', () => {
		const value = receiptFixture();
		value.range.ledgerCount = 3;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/inconsistent/i
		);
	});

	it('rejects a gap between source objects', () => {
		const value = receiptFixture();
		value.sourceObjects[1]!.startLedger = 5;
		value.sourceObjects[1]!.endLedger = 5;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/not contiguous/i
		);
	});

	it('rejects a ledger-hash discontinuity between source objects', () => {
		const value = receiptFixture();
		value.sourceObjects[1]!.firstPreviousLedgerHash = DIGEST_A;
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
			/chain hash/i
		);
	});

	it('rejects an incompatible manifest or output schema version', () => {
		const manifest = manifestFixture();
		manifest.manifestVersion = 'stellar-atlas.full-history-etl.manifest.v5';
		expect(() => parseGoFullHistoryLedgerCloseMetaManifest(manifest)).toThrow(
			/not compatible/i
		);

		const receipt = receiptFixture();
		receipt.outputs[0]!.schemaVersion = 'unrecognized';
		expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(receipt)).toThrow(
			/incomplete/i
		);
	});

	it('accepts immutable v6 and v7 manifests while requiring v8 state projections', () => {
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(legacyFixture())
		).not.toThrow();
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(v7Fixture())
		).not.toThrow();

		const mismatched = manifestFixture();
		mismatched.outputs.find(
			(output) => output.dataset === 'contract-events'
		)!.schemaVersion = 'stellar-atlas.full-history.contract-events.v2';
		expect(() => parseGoFullHistoryLedgerCloseMetaManifest(mismatched)).toThrow(
			/(?:incomplete|not compatible)/i
		);

		const partial = manifestFixture();
		partial.outputs.pop();
		expect(() => parseGoFullHistoryLedgerCloseMetaManifest(partial)).toThrow(
			/incomplete/i
		);
	});

	it('requires canonical createdAt and bounded processing limits', () => {
		const missingCreatedAt = manifestFixture();
		Reflect.deleteProperty(missingCreatedAt, 'createdAt');
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(missingCreatedAt)
		).toThrow(/createdAt is required/i);

		for (const createdAt of [
			'2026-02-30T16:01:02Z',
			'2026-07-15T16:01:02.120Z',
			'2026-07-15T16:01:02+00:00'
		]) {
			const value = manifestFixture();
			value.createdAt = createdAt;
			expect(() => parseGoFullHistoryLedgerCloseMetaManifest(value)).toThrow(
				/canonical UTC timestamp/i
			);
		}

		const missingLimits = manifestFixture();
		Reflect.deleteProperty(missingLimits, 'limits');
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(missingLimits)
		).toThrow(/limits is required/i);

		const invalidLimit = manifestFixture();
		invalidLimit.limits.maxRows = 0;
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(invalidLimit)
		).toThrow(/maxRows must be a safe integer/i);

		const exceededLimit = manifestFixture();
		exceededLimit.limits.maxOutputBytes = 1;
		expect(() =>
			parseGoFullHistoryLedgerCloseMetaManifest(exceededLimit)
		).toThrow(/output bytes exceed recorded limits/i);
	});

	it('rejects unknown receipt root and nested keys', () => {
		const targets: readonly ((value: ReceiptFixture) => object)[] = [
			(value) => value,
			(value) => value.network,
			(value) => value.range,
			(value) => value.sourceObjects[0]!,
			(value) => value.outputs[0]!
		];
		for (const target of targets) {
			const value = receiptFixture();
			Object.assign(target(value), { unexpected: true });
			expect(() => parseGoFullHistoryLedgerCloseMetaReceipt(value)).toThrow(
				/unknown key unexpected/i
			);
		}
	});

	it('rejects unknown manifest root and nested keys', () => {
		const targets: readonly ((value: ManifestFixture) => object)[] = [
			(value) => value,
			(value) => value.network,
			(value) => value.range,
			(value) => value.sourceObjects[0]!,
			(value) => value.outputs[0]!,
			(value) => value.format,
			(value) => value.limits
		];
		for (const target of targets) {
			const value = manifestFixture();
			Object.assign(target(value), { unexpected: true });
			expect(() => parseGoFullHistoryLedgerCloseMetaManifest(value)).toThrow(
				/unknown key unexpected/i
			);
		}
	});
});

function manifestFixture() {
	return {
		createdAt: '2026-07-15T16:01:02.123456789Z',
		format: {
			canonicalLedgerCloseMetaEncoding: 'xdr+zstd',
			name: 'stellar-atlas-full-history-shard',
			parquetCompression: 'zstd',
			parquetWriter: 'github.com/xitongsys/parquet-go@v1.6.2',
			partitionColumns: ['ledger_sequence'],
			stellarSdk: 'github.com/stellar/go-stellar-sdk@v0.6.0',
			stellarXdrCommit: '68fa1ac55692f68ad2a2ca549d0a283273554439'
		},
		inputMediaType: 'application/x-stellar-ledger-close-meta-batch+xdr+zstd',
		limits: {
			maxCompressedBytes: 1 << 20,
			maxDecodedMemoryBytes: 1 << 20,
			maxLedgers: 1_024,
			maxOutputBytes: 1 << 20,
			maxRows: 10_000,
			maxUncompressedBytes: 1 << 20
		},
		manifestVersion: 'stellar-atlas.full-history-etl.manifest.v8',
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
			'account-current-state-and-signers',
			'assets',
			'trustline-current-state',
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

function receiptFixture() {
	const manifest = manifestFixture();
	return {
		inputMediaType: manifest.inputMediaType,
		manifestSha256: DIGEST_A,
		manifestStorageKey: `${NETWORK_ID}/ledger-close-meta/3-4/manifest.json`,
		network: manifest.network,
		outputs: manifest.outputs,
		range: manifest.range,
		sourceObjects: manifest.sourceObjects
	};
}

function v7Fixture() {
	const value = manifestFixture();
	value.manifestVersion = 'stellar-atlas.full-history-etl.manifest.v7';
	value.outputs = value.outputs.filter(
		(output) =>
			output.dataset !== 'account-state-changes' &&
			output.dataset !== 'trustline-state-changes'
	);
	value.unsupportedDatasets = [...UNSUPPORTED_V7];
	return value;
}

type ManifestFixture = ReturnType<typeof manifestFixture>;
type ReceiptFixture = ReturnType<typeof receiptFixture>;

function legacyFixture() {
	const value = v7Fixture();
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
	'ledger-entry-changes',
	'account-state-changes',
	'trustline-state-changes'
] as const;
const SCHEMA_VERSIONS = {
	'account-state-changes':
		'stellar-atlas.full-history.account-state-changes.v1',
	'contract-events': 'stellar-atlas.full-history.contract-events.v3',
	'ledger-close-meta': 'stellar-atlas.full-history.ledger-close-meta-batch.v1',
	'ledger-entry-changes': 'stellar-atlas.full-history.ledger-entry-changes.v3',
	ledgers: 'stellar-atlas.full-history.ledgers.v2',
	operations: 'stellar-atlas.full-history.operations.v2',
	'transaction-meta': 'stellar-atlas.full-history.transaction-meta.v2',
	'transaction-results': 'stellar-atlas.full-history.transaction-results.v2',
	transactions: 'stellar-atlas.full-history.transactions.v2',
	'trustline-state-changes':
		'stellar-atlas.full-history.trustline-state-changes.v1'
} as const;

const UNSUPPORTED_V7 = [
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
] as const;
