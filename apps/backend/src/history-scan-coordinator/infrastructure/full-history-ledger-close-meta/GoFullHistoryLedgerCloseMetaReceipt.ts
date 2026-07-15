import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS,
	isValidFullHistoryLedgerCloseMetaOutputSet,
	type FullHistoryLedgerCloseMetaDataset,
	type FullHistoryLedgerCloseMetaDatasetOutput
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';

export interface GoFullHistoryLedgerCloseMetaReceipt extends GoFullHistoryLedgerCloseMetaCore {
	readonly manifestSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly manifestStorageKey: string;
}

export interface GoFullHistoryLedgerCloseMetaManifest extends GoFullHistoryLedgerCloseMetaCore {
	readonly format: GoFullHistoryLedgerCloseMetaFormat;
	readonly manifestVersion: string;
	readonly unsupportedDatasets: readonly string[];
}

export interface GoFullHistoryLedgerCloseMetaCore {
	readonly inputMediaType: typeof expectedInputMediaType;
	readonly network: GoFullHistoryLedgerCloseMetaNetwork;
	readonly outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[];
	readonly range: FullHistoryLedgerCloseMetaRange;
	readonly sourceObjects: readonly GoFullHistoryLedgerCloseMetaSourceObjectEvidence[];
}

export interface GoFullHistoryLedgerCloseMetaFormat {
	readonly canonicalLedgerCloseMetaEncoding: 'xdr+zstd';
	readonly name: 'stellar-atlas-full-history-shard';
	readonly parquetCompression: 'zstd';
	readonly parquetWriter: 'github.com/xitongsys/parquet-go@v1.6.2';
	readonly partitionColumns: readonly ['ledger_sequence'];
	readonly stellarSdk: 'github.com/stellar/go-stellar-sdk@v0.6.0';
	readonly stellarXdrCommit: '68fa1ac55692f68ad2a2ca549d0a283273554439';
}

export interface GoFullHistoryLedgerCloseMetaSourceObjectEvidence {
	readonly compressedByteCount: number;
	readonly compressedSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly firstPreviousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly lastLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly objectKey: string;
	readonly range: FullHistoryLedgerCloseMetaRange;
	readonly xdrByteCount: number;
	readonly xdrSha256: FullHistoryLedgerCloseMetaSha256Digest;
}

export interface GoFullHistoryLedgerCloseMetaNetwork {
	readonly name: string;
	readonly networkIdSha256: FullHistoryLedgerCloseMetaSha256Digest;
}

const datasets = new Set<FullHistoryLedgerCloseMetaDataset>([
	...FULL_HISTORY_LEDGER_CLOSE_META_DATASETS
]);
const legacyManifestVersion =
	'stellar-atlas.full-history-etl.manifest.v6' as const;
const currentManifestVersion =
	'stellar-atlas.full-history-etl.manifest.v7' as const;
const expectedInputMediaType =
	'application/x-stellar-ledger-close-meta-batch+xdr+zstd' as const;
const currentUnsupportedDatasets = [
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
const legacyUnsupportedDatasets = [
	...currentUnsupportedDatasets.slice(0, 12),
	'contract-event-topics-and-data',
	'ledger-entry-keys-and-values',
	...currentUnsupportedDatasets.slice(12)
] as const;

export function parseGoFullHistoryLedgerCloseMetaReceipt(
	value: unknown
): GoFullHistoryLedgerCloseMetaReceipt {
	const row = objectValue(value, 'processing receipt');
	return Object.freeze({
		...parseCore(row),
		manifestSha256: digestValue(row.manifestSha256, 'manifestSha256'),
		manifestStorageKey: boundedString(
			row.manifestStorageKey,
			'manifestStorageKey',
			2_048
		)
	});
}

export function parseGoFullHistoryLedgerCloseMetaManifest(
	value: unknown
): GoFullHistoryLedgerCloseMetaManifest {
	const row = objectValue(value, 'processing manifest');
	const core = parseCore(row);
	const manifestVersion = parseManifestVersion(row.manifestVersion);
	assertManifestProjectionSchemas(manifestVersion, core.outputs);
	return Object.freeze({
		...core,
		format: parseFormat(row.format),
		manifestVersion,
		unsupportedDatasets: exactStringArray(
			row.unsupportedDatasets,
			'unsupportedDatasets',
			manifestVersion === legacyManifestVersion
				? legacyUnsupportedDatasets
				: currentUnsupportedDatasets
		)
	});
}

function parseManifestVersion(
	value: unknown
): typeof legacyManifestVersion | typeof currentManifestVersion {
	if (value === legacyManifestVersion || value === currentManifestVersion) {
		return value;
	}
	throw new TypeError('manifestVersion is not compatible with this service');
}

function assertManifestProjectionSchemas(
	manifestVersion: typeof legacyManifestVersion | typeof currentManifestVersion,
	outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[]
): void {
	const expected =
		manifestVersion === legacyManifestVersion
			? {
					'contract-events':
						'stellar-atlas.full-history.contract-events.v2',
					'ledger-entry-changes':
						'stellar-atlas.full-history.ledger-entry-changes.v2'
				}
			: {
					'contract-events':
						FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['contract-events'],
					'ledger-entry-changes':
						FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS[
							'ledger-entry-changes'
						]
				};
	for (const dataset of ['contract-events', 'ledger-entry-changes'] as const) {
		if (
			outputs.find((output) => output.dataset === dataset)?.schemaVersion !==
			expected[dataset]
		) {
			throw new TypeError(
				`${dataset} schema is not compatible with ${manifestVersion}`
			);
		}
	}
}

export function processingManifestIdentity(
	manifest: GoFullHistoryLedgerCloseMetaCore
): string {
	return JSON.stringify({
		inputMediaType: manifest.inputMediaType,
		network: manifest.network,
		outputs: [...manifest.outputs].sort((left, right) =>
			left.dataset.localeCompare(right.dataset)
		),
		range: manifest.range,
		sourceObjects: manifest.sourceObjects
	});
}

function parseCore(
	row: Readonly<Record<string, unknown>>
): GoFullHistoryLedgerCloseMetaCore {
	const networkRow = objectValue(row.network, 'network');
	const range = parseRange(row.range, 'range');
	const outputsValue = row.outputs;
	if (!Array.isArray(outputsValue) || outputsValue.length === 0) {
		throw new TypeError('LedgerCloseMeta manifest has no typed outputs');
	}
	const sourceValues = row.sourceObjects;
	if (!Array.isArray(sourceValues) || sourceValues.length === 0) {
		throw new TypeError(
			'LedgerCloseMeta manifest has no source-object evidence'
		);
	}
	const sourceObjects = Object.freeze(sourceValues.map(parseSourceObject));
	assertSourceCoverage(range, sourceObjects);
	const outputs = Object.freeze(outputsValue.map(parseOutput));
	if (!isValidFullHistoryLedgerCloseMetaOutputSet(range, outputs)) {
		throw new TypeError('LedgerCloseMeta manifest output set is incomplete');
	}
	return Object.freeze({
		inputMediaType: exactString(
			row.inputMediaType,
			'inputMediaType',
			expectedInputMediaType
		),
		network: Object.freeze({
			name: boundedString(networkRow.name, 'network.name', 64),
			networkIdSha256: digestValue(
				networkRow.networkIdSha256,
				'network.networkIdSha256'
			)
		}),
		outputs,
		range,
		sourceObjects
	});
}

function parseFormat(value: unknown): GoFullHistoryLedgerCloseMetaFormat {
	const row = objectValue(value, 'format');
	return Object.freeze({
		canonicalLedgerCloseMetaEncoding: exactString(
			row.canonicalLedgerCloseMetaEncoding,
			'format.canonicalLedgerCloseMetaEncoding',
			'xdr+zstd'
		),
		name: exactString(
			row.name,
			'format.name',
			'stellar-atlas-full-history-shard'
		),
		parquetCompression: exactString(
			row.parquetCompression,
			'format.parquetCompression',
			'zstd'
		),
		parquetWriter: exactString(
			row.parquetWriter,
			'format.parquetWriter',
			'github.com/xitongsys/parquet-go@v1.6.2'
		),
		partitionColumns: exactStringArray(
			row.partitionColumns,
			'format.partitionColumns',
			['ledger_sequence'] as const
		),
		stellarSdk: exactString(
			row.stellarSdk,
			'format.stellarSdk',
			'github.com/stellar/go-stellar-sdk@v0.6.0'
		),
		stellarXdrCommit: exactString(
			row.stellarXdrCommit,
			'format.stellarXdrCommit',
			'68fa1ac55692f68ad2a2ca549d0a283273554439'
		)
	});
}

function parseSourceObject(
	value: unknown,
	index: number
): GoFullHistoryLedgerCloseMetaSourceObjectEvidence {
	const row = objectValue(value, `sourceObjects[${index}]`);
	return Object.freeze({
		compressedByteCount: safeInteger(
			row.compressedByteCount,
			`sourceObjects[${index}].compressedByteCount`,
			1
		),
		compressedSha256: digestValue(
			row.compressedSha256,
			`sourceObjects[${index}].compressedSha256`
		),
		firstPreviousLedgerHash: digestValue(
			row.firstPreviousLedgerHash,
			`sourceObjects[${index}].firstPreviousLedgerHash`
		),
		lastLedgerHash: digestValue(
			row.lastLedgerHash,
			`sourceObjects[${index}].lastLedgerHash`
		),
		objectKey: boundedString(
			row.objectKey,
			`sourceObjects[${index}].objectKey`,
			2_048
		),
		range: parseRange(row, `sourceObjects[${index}]`),
		xdrByteCount: safeInteger(
			row.xdrByteCount,
			`sourceObjects[${index}].xdrByteCount`,
			1
		),
		xdrSha256: digestValue(row.xdrSha256, `sourceObjects[${index}].xdrSha256`)
	});
}

function parseOutput(
	value: unknown,
	index: number
): FullHistoryLedgerCloseMetaDatasetOutput {
	const row = objectValue(value, `outputs[${index}]`);
	const dataset = boundedString(row.dataset, `outputs[${index}].dataset`, 64);
	if (!datasets.has(dataset as FullHistoryLedgerCloseMetaDataset)) {
		throw new TypeError(`Unsupported LedgerCloseMeta dataset ${dataset}`);
	}
	return Object.freeze({
		byteCount: safeInteger(row.byteCount, `outputs[${index}].byteCount`, 1),
		dataset: dataset as FullHistoryLedgerCloseMetaDataset,
		mediaType: boundedString(row.mediaType, `outputs[${index}].mediaType`, 128),
		recordCount: safeInteger(
			row.recordCount,
			`outputs[${index}].recordCount`,
			0
		),
		representation: representationValue(
			row.representation,
			`outputs[${index}].representation`
		),
		schemaVersion: boundedString(
			row.schemaVersion,
			`outputs[${index}].schemaVersion`,
			64
		),
		sha256: digestValue(row.sha256, `outputs[${index}].sha256`),
		storageKey: boundedString(
			row.storageKey,
			`outputs[${index}].storageKey`,
			2_048
		)
	});
}

function parseRange(
	value: unknown,
	field: string
): FullHistoryLedgerCloseMetaRange {
	const row = objectValue(value, field);
	const startLedger = safeInteger(row.startLedger, `${field}.startLedger`, 1);
	const endLedger = safeInteger(row.endLedger, `${field}.endLedger`, 1);
	const range = fullHistoryLedgerCloseMetaRange(startLedger, endLedger);
	if (
		safeInteger(row.ledgerCount, `${field}.ledgerCount`, 1) !==
		range.ledgerCount
	) {
		throw new TypeError(`LedgerCloseMeta ${field} count is inconsistent`);
	}
	return range;
}

function assertSourceCoverage(
	range: FullHistoryLedgerCloseMetaRange,
	sources: readonly GoFullHistoryLedgerCloseMetaSourceObjectEvidence[]
): void {
	let nextLedger: number = range.startSequence;
	let previousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest | null = null;
	for (const source of sources) {
		if (
			source.range.startSequence !== nextLedger ||
			(previousLedgerHash !== null &&
				source.firstPreviousLedgerHash !== previousLedgerHash)
		) {
			throw new TypeError(
				'LedgerCloseMeta source-object evidence is not contiguous by ledger sequence and chain hash'
			);
		}
		nextLedger = source.range.endSequence + 1;
		previousLedgerHash = source.lastLedgerHash;
	}
	if (nextLedger !== range.endSequence + 1) {
		throw new TypeError(
			'LedgerCloseMeta source objects do not cover the shard'
		);
	}
}

function representationValue(
	value: unknown,
	field: string
): 'lossless-replay' | 'typed-projection' {
	if (value !== 'lossless-replay' && value !== 'typed-projection') {
		throw new TypeError(`${field} is unsupported`);
	}
	return value;
}

function digestValue(
	value: unknown,
	field: string
): FullHistoryLedgerCloseMetaSha256Digest {
	if (typeof value !== 'string')
		throw new TypeError(`${field} must be a string`);
	return fullHistoryLedgerCloseMetaSha256Digest(value);
}

function boundedString(value: unknown, field: string, maximum: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
		throw new TypeError(`${field} must be a non-empty bounded string`);
	}
	return value;
}

function exactString<const Expected extends string>(
	value: unknown,
	field: string,
	expected: Expected
): Expected {
	if (value !== expected) {
		throw new TypeError(`${field} is not compatible with this service`);
	}
	return expected;
}

function exactStringArray<const Expected extends readonly string[]>(
	value: unknown,
	field: string,
	expected: Expected
): Expected {
	if (
		!Array.isArray(value) ||
		value.length !== expected.length ||
		value.some((item, index) => item !== expected[index])
	) {
		throw new TypeError(`${field} is not compatible with this service`);
	}
	return expected;
}

function safeInteger(value: unknown, field: string, minimum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new TypeError(`${field} must be a safe integer >= ${minimum}`);
	}
	return value as number;
}

function objectValue(
	value: unknown,
	field: string
): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${field} must be an object`);
	}
	return value as Readonly<Record<string, unknown>>;
}
