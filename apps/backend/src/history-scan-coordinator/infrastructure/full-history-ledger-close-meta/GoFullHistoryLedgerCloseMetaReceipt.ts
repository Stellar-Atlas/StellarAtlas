import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	FULL_HISTORY_LEDGER_CLOSE_META_DATASETS,
	isValidFullHistoryLedgerCloseMetaOutputSet,
	type FullHistoryLedgerCloseMetaDataset,
	type FullHistoryLedgerCloseMetaDatasetOutput
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaProcessing.js';
import {
	assertLedgerCloseMetaManifestProjection,
	expectedUnsupportedLedgerCloseMetaDatasets,
	goFullHistoryLedgerCloseMetaManifestVersion,
	type GoFullHistoryLedgerCloseMetaManifestVersion
} from './GoFullHistoryLedgerCloseMetaManifestContract.js';
import {
	boundedString,
	exactObjectValue,
	exactString,
	exactStringArray,
	parseManifestCreatedAt,
	parseManifestFormat,
	parseManifestLimits,
	safeInteger,
	type GoFullHistoryLedgerCloseMetaFormat,
	type GoFullHistoryLedgerCloseMetaLimits
} from './GoFullHistoryLedgerCloseMetaManifestMetadata.js';

export type {
	GoFullHistoryLedgerCloseMetaFormat,
	GoFullHistoryLedgerCloseMetaLimits
} from './GoFullHistoryLedgerCloseMetaManifestMetadata.js';

export interface GoFullHistoryLedgerCloseMetaReceipt extends GoFullHistoryLedgerCloseMetaCore {
	readonly manifestSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly manifestStorageKey: string;
}

export interface GoFullHistoryLedgerCloseMetaManifest extends GoFullHistoryLedgerCloseMetaCore {
	readonly createdAt: string;
	readonly format: GoFullHistoryLedgerCloseMetaFormat;
	readonly limits: GoFullHistoryLedgerCloseMetaLimits;
	readonly manifestVersion: GoFullHistoryLedgerCloseMetaManifestVersion;
	readonly unsupportedDatasets: readonly string[];
}

export interface GoFullHistoryLedgerCloseMetaCore {
	readonly inputMediaType: typeof expectedInputMediaType;
	readonly network: GoFullHistoryLedgerCloseMetaNetwork;
	readonly outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[];
	readonly range: FullHistoryLedgerCloseMetaRange;
	readonly sourceObjects: readonly GoFullHistoryLedgerCloseMetaSourceObjectEvidence[];
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
const expectedInputMediaType =
	'application/x-stellar-ledger-close-meta-batch+xdr+zstd' as const;
const maximumSourceObjects = 1_024;
const receiptKeys = [
	'manifestSha256',
	'manifestStorageKey',
	'network',
	'range',
	'inputMediaType',
	'sourceObjects',
	'outputs'
] as const;
const manifestKeys = [
	'manifestVersion',
	'createdAt',
	'network',
	'range',
	'inputMediaType',
	'sourceObjects',
	'format',
	'limits',
	'outputs',
	'unsupportedDatasets'
] as const;
const networkKeys = ['name', 'networkIdSha256'] as const;
const rangeKeys = ['startLedger', 'endLedger', 'ledgerCount'] as const;
const sourceObjectKeys = [
	'objectKey',
	'startLedger',
	'endLedger',
	'ledgerCount',
	'compressedByteCount',
	'compressedSha256',
	'firstPreviousLedgerHash',
	'lastLedgerHash',
	'xdrByteCount',
	'xdrSha256'
] as const;
const outputKeys = [
	'byteCount',
	'dataset',
	'mediaType',
	'recordCount',
	'representation',
	'schemaVersion',
	'sha256',
	'storageKey'
] as const;

export function parseGoFullHistoryLedgerCloseMetaReceipt(
	value: unknown
): GoFullHistoryLedgerCloseMetaReceipt {
	const row = exactObjectValue(value, 'processing receipt', receiptKeys);
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
	const row = exactObjectValue(value, 'processing manifest', manifestKeys);
	const core = parseCore(row);
	const limits = parseManifestLimits(row.limits);
	assertManifestLimits(core, limits);
	const manifestVersion = goFullHistoryLedgerCloseMetaManifestVersion(
		row.manifestVersion
	);
	assertLedgerCloseMetaManifestProjection(manifestVersion, core.outputs);
	return Object.freeze({
		...core,
		createdAt: parseManifestCreatedAt(row.createdAt),
		format: parseManifestFormat(row.format),
		limits,
		manifestVersion,
		unsupportedDatasets: exactStringArray(
			row.unsupportedDatasets,
			'unsupportedDatasets',
			expectedUnsupportedLedgerCloseMetaDatasets(manifestVersion)
		)
	});
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
	const networkRow = exactObjectValue(row.network, 'network', networkKeys);
	const range = parseRange(row.range, 'range');
	const outputsValue = row.outputs;
	if (!Array.isArray(outputsValue) || outputsValue.length === 0) {
		throw new TypeError('LedgerCloseMeta manifest has no typed outputs');
	}
	const sourceValues = row.sourceObjects;
	if (
		!Array.isArray(sourceValues) ||
		sourceValues.length === 0 ||
		sourceValues.length > maximumSourceObjects
	) {
		throw new TypeError(
			`LedgerCloseMeta manifest must have 1-${maximumSourceObjects} source-object evidence rows`
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

function parseSourceObject(
	value: unknown,
	index: number
): GoFullHistoryLedgerCloseMetaSourceObjectEvidence {
	const field = `sourceObjects[${index}]`;
	const row = exactObjectValue(value, field, sourceObjectKeys);
	return Object.freeze({
		compressedByteCount: safeInteger(
			row.compressedByteCount,
			`${field}.compressedByteCount`,
			1
		),
		compressedSha256: digestValue(
			row.compressedSha256,
			`${field}.compressedSha256`
		),
		firstPreviousLedgerHash: digestValue(
			row.firstPreviousLedgerHash,
			`${field}.firstPreviousLedgerHash`
		),
		lastLedgerHash: digestValue(row.lastLedgerHash, `${field}.lastLedgerHash`),
		objectKey: boundedString(row.objectKey, `${field}.objectKey`, 1_024),
		range: parseRangeRow(row, field),
		xdrByteCount: safeInteger(row.xdrByteCount, `${field}.xdrByteCount`, 1),
		xdrSha256: digestValue(row.xdrSha256, `${field}.xdrSha256`)
	});
}

function parseOutput(
	value: unknown,
	index: number
): FullHistoryLedgerCloseMetaDatasetOutput {
	const field = `outputs[${index}]`;
	const row = exactObjectValue(value, field, outputKeys);
	const dataset = boundedString(row.dataset, `${field}.dataset`, 64);
	if (!datasets.has(dataset as FullHistoryLedgerCloseMetaDataset)) {
		throw new TypeError(`Unsupported LedgerCloseMeta dataset ${dataset}`);
	}
	return Object.freeze({
		byteCount: safeInteger(row.byteCount, `${field}.byteCount`, 1),
		dataset: dataset as FullHistoryLedgerCloseMetaDataset,
		mediaType: boundedString(row.mediaType, `${field}.mediaType`, 128),
		recordCount: safeInteger(row.recordCount, `${field}.recordCount`, 0),
		representation: representationValue(
			row.representation,
			`${field}.representation`
		),
		schemaVersion: boundedString(
			row.schemaVersion,
			`${field}.schemaVersion`,
			64
		),
		sha256: digestValue(row.sha256, `${field}.sha256`),
		storageKey: boundedString(row.storageKey, `${field}.storageKey`, 2_048)
	});
}

function parseRange(
	value: unknown,
	field: string
): FullHistoryLedgerCloseMetaRange {
	const row = exactObjectValue(value, field, rangeKeys);
	return parseRangeRow(row, field);
}

function parseRangeRow(
	row: Readonly<Record<string, unknown>>,
	field: string
): FullHistoryLedgerCloseMetaRange {
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
	const objectKeys = new Set<string>();
	let nextLedger: number = range.startSequence;
	let previousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest | null = null;
	for (const source of sources) {
		if (
			objectKeys.has(source.objectKey) ||
			source.range.startSequence !== nextLedger ||
			(previousLedgerHash !== null &&
				source.firstPreviousLedgerHash !== previousLedgerHash)
		) {
			throw new TypeError(
				'LedgerCloseMeta source-object evidence is not contiguous by ledger sequence and chain hash'
			);
		}
		objectKeys.add(source.objectKey);
		nextLedger = source.range.endSequence + 1;
		previousLedgerHash = source.lastLedgerHash;
	}
	if (nextLedger !== range.endSequence + 1) {
		throw new TypeError(
			'LedgerCloseMeta source objects do not cover the shard'
		);
	}
}

function assertManifestLimits(
	core: GoFullHistoryLedgerCloseMetaCore,
	limits: GoFullHistoryLedgerCloseMetaLimits
): void {
	if (core.range.ledgerCount > limits.maxLedgers) {
		throw new TypeError('LedgerCloseMeta range exceeds limits.maxLedgers');
	}
	assertAggregateLimit(
		core.sourceObjects.map((source) => source.compressedByteCount),
		limits.maxCompressedBytes,
		'compressed source bytes'
	);
	assertAggregateLimit(
		core.sourceObjects.map((source) => source.xdrByteCount),
		limits.maxUncompressedBytes,
		'uncompressed source bytes'
	);
	assertAggregateLimit(
		core.outputs.map((output) => output.byteCount),
		limits.maxOutputBytes,
		'output bytes'
	);
	assertAggregateLimit(
		core.outputs.map((output) => output.recordCount),
		limits.maxRows,
		'output rows'
	);
}

function assertAggregateLimit(
	values: readonly number[],
	limit: number,
	field: string
): void {
	let total = 0;
	for (const value of values) {
		if (value > limit - total) {
			throw new TypeError(`LedgerCloseMeta ${field} exceed recorded limits`);
		}
		total += value;
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
