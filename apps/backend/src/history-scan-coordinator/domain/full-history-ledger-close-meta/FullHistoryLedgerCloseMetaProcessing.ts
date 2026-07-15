import {
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaBatchEvidence,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSha256Digest
} from './FullHistoryLedgerCloseMetaBatch.js';
import type { FullHistoryLedgerCloseMetaSourceObject } from './FullHistoryLedgerCloseMetaSource.js';

export const FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION =
	'discarded-after-processing' as const;

export const FULL_HISTORY_LEDGER_CLOSE_META_DATASETS = [
	'ledger-close-meta',
	'ledgers',
	'transactions',
	'operations',
	'transaction-results',
	'transaction-meta',
	'contract-events',
	'ledger-entry-changes'
] as const;

export type FullHistoryLedgerCloseMetaDataset =
	(typeof FULL_HISTORY_LEDGER_CLOSE_META_DATASETS)[number];

export const FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE =
	'application/x-stellar-ledger-close-meta-batch+xdr+zstd';
export const FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE =
	'application/vnd.apache.parquet';

export const FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS = {
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
} as const satisfies Record<FullHistoryLedgerCloseMetaDataset, string>;

export const FULL_HISTORY_LEDGER_CLOSE_META_SUPPORTED_SCHEMA_VERSIONS = {
	'contract-events': [
		'stellar-atlas.full-history.contract-events.v2',
		FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['contract-events']
	],
	'ledger-close-meta': [
		FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['ledger-close-meta']
	],
	'ledger-entry-changes': [
		'stellar-atlas.full-history.ledger-entry-changes.v2',
		FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['ledger-entry-changes']
	],
	ledgers: [FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS.ledgers],
	operations: [FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS.operations],
	'transaction-meta': [
		FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['transaction-meta']
	],
	'transaction-results': [
		FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS['transaction-results']
	],
	transactions: [FULL_HISTORY_LEDGER_CLOSE_META_SCHEMA_VERSIONS.transactions]
} as const satisfies Record<
	FullHistoryLedgerCloseMetaDataset,
	readonly string[]
>;

export type FullHistoryLedgerCloseMetaRepresentation =
	'lossless-replay' | 'typed-projection';

export interface FullHistoryLedgerCloseMetaProcessingRequest {
	readonly inputs: readonly FullHistoryLedgerCloseMetaProcessingInput[];
	readonly networkPassphrase: string;
	readonly source: {
		readonly configDigest: FullHistoryLedgerCloseMetaSha256Digest;
		readonly sourceId: string;
	};
}

export interface FullHistoryLedgerCloseMetaProcessingInput {
	readonly expectedRange: FullHistoryLedgerCloseMetaRange;
	readonly object: FullHistoryLedgerCloseMetaSourceObject;
}

export interface FullHistoryLedgerCloseMetaProcessingReceipt {
	readonly manifestSha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly outputs: readonly FullHistoryLedgerCloseMetaDatasetOutput[];
	readonly range: FullHistoryLedgerCloseMetaRange;
	readonly sourceDisposition: typeof FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION;
	readonly sourceObjects: readonly FullHistoryLedgerCloseMetaSourceObjectEvidence[];
}

export interface FullHistoryLedgerCloseMetaSourceObjectEvidence extends FullHistoryLedgerCloseMetaBatchEvidence {
	readonly etag?: string;
	readonly firstPreviousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly generation: string;
	readonly lastLedgerHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly objectKey: string;
}

export interface FullHistoryLedgerCloseMetaDatasetOutput {
	readonly byteCount: number;
	readonly dataset: FullHistoryLedgerCloseMetaDataset;
	readonly mediaType: string;
	readonly recordCount: number;
	readonly representation: FullHistoryLedgerCloseMetaRepresentation;
	readonly schemaVersion: string;
	readonly sha256: FullHistoryLedgerCloseMetaSha256Digest;
	readonly storageKey: string;
}

export interface FullHistoryLedgerCloseMetaProcessorPort {
	processAndCommit(
		request: FullHistoryLedgerCloseMetaProcessingRequest,
		signal: AbortSignal
	): Promise<FullHistoryLedgerCloseMetaProcessingReceipt>;
}

export function assertFullHistoryLedgerCloseMetaProcessingReceipt(
	receipt: FullHistoryLedgerCloseMetaProcessingReceipt
): void {
	fullHistoryLedgerCloseMetaSha256Digest(receipt.manifestSha256);
	for (const source of receipt.sourceObjects) {
		fullHistoryLedgerCloseMetaSha256Digest(source.compressedSha256);
		fullHistoryLedgerCloseMetaSha256Digest(source.firstPreviousLedgerHash);
		fullHistoryLedgerCloseMetaSha256Digest(source.lastLedgerHash);
		fullHistoryLedgerCloseMetaSha256Digest(source.xdrSha256);
	}
	for (const output of receipt.outputs) {
		fullHistoryLedgerCloseMetaSha256Digest(output.sha256);
	}
	if (
		receipt.sourceDisposition !==
			FULL_HISTORY_LEDGER_CLOSE_META_SOURCE_DISPOSITION ||
		!isValidFullHistoryLedgerCloseMetaOutputSet(
			receipt.range,
			receipt.outputs
		) ||
		receipt.sourceObjects.length === 0 ||
		!isValidSourceCoverage(receipt.range, receipt.sourceObjects) ||
		new Set(receipt.outputs.map((output) => output.dataset)).size !==
			receipt.outputs.length
	) {
		throw new TypeError('Ledger-close-meta processing receipt is incomplete');
	}
}

export function isValidFullHistoryLedgerCloseMetaOutputSet(
	range: FullHistoryLedgerCloseMetaRange,
	outputList: readonly FullHistoryLedgerCloseMetaDatasetOutput[]
): boolean {
	if (outputList.length !== FULL_HISTORY_LEDGER_CLOSE_META_DATASETS.length) {
		return false;
	}
	const outputs = new Map(outputList.map((output) => [output.dataset, output]));
	if (
		FULL_HISTORY_LEDGER_CLOSE_META_DATASETS.some(
			(dataset) => !outputs.has(dataset)
		) ||
		outputList.some((output) => !isValidOutput(output))
	) {
		return false;
	}
	const canonical = outputs.get('ledger-close-meta');
	const ledgers = outputs.get('ledgers');
	const transactions = outputs.get('transactions');
	return (
		canonical?.recordCount === range.ledgerCount &&
		ledgers?.recordCount === range.ledgerCount &&
		transactions !== undefined &&
		outputs.get('transaction-results')?.recordCount ===
			transactions.recordCount &&
		outputs.get('transaction-meta')?.recordCount === transactions.recordCount
	);
}

function isValidSourceCoverage(
	range: FullHistoryLedgerCloseMetaRange,
	sources: readonly FullHistoryLedgerCloseMetaSourceObjectEvidence[]
): boolean {
	if (
		range.ledgerCount !== range.endSequence - range.startSequence + 1 ||
		new Set(sources.map((source) => source.objectKey)).size !== sources.length
	) {
		return false;
	}
	let nextSequence: number = range.startSequence;
	let previousLedgerHash: FullHistoryLedgerCloseMetaSha256Digest | null = null;
	for (const source of sources) {
		if (
			!isValidSourceEvidence(source) ||
			(previousLedgerHash !== null &&
				source.firstPreviousLedgerHash !== previousLedgerHash) ||
			(source.etag !== undefined && source.etag.length > 512) ||
			source.generation.length < 1 ||
			source.generation.length > 1_024 ||
			source.objectKey.length < 1 ||
			source.objectKey.length > 2_048 ||
			source.range.startSequence !== nextSequence
		) {
			return false;
		}
		nextSequence = source.range.endSequence + 1;
		previousLedgerHash = source.lastLedgerHash;
	}
	return nextSequence === range.endSequence + 1;
}

function isValidSourceEvidence(
	evidence: FullHistoryLedgerCloseMetaBatchEvidence
): boolean {
	return (
		Number.isSafeInteger(evidence.compressedByteCount) &&
		evidence.compressedByteCount > 0 &&
		Number.isSafeInteger(evidence.xdrByteCount) &&
		evidence.xdrByteCount > 0 &&
		evidence.range.ledgerCount ===
			evidence.range.endSequence - evidence.range.startSequence + 1
	);
}

function isValidOutput(
	output: FullHistoryLedgerCloseMetaDatasetOutput
): boolean {
	return (
		Number.isSafeInteger(output.byteCount) &&
		output.byteCount > 0 &&
		Number.isSafeInteger(output.recordCount) &&
		output.recordCount >= 0 &&
		isSupportedSchemaVersion(output) &&
		output.mediaType ===
			(output.dataset === 'ledger-close-meta'
				? FULL_HISTORY_LEDGER_CLOSE_META_CANONICAL_MEDIA_TYPE
				: FULL_HISTORY_LEDGER_CLOSE_META_PARQUET_MEDIA_TYPE) &&
		output.representation ===
			(output.dataset === 'ledger-close-meta'
				? 'lossless-replay'
				: 'typed-projection') &&
		output.storageKey.length > 0 &&
		output.storageKey.length <= 2_048 &&
		!output.storageKey.startsWith('/') &&
		!output.storageKey.includes('\\') &&
		!output.storageKey.split('/').some((part) => part === '..')
	);
}

function isSupportedSchemaVersion(
	output: FullHistoryLedgerCloseMetaDatasetOutput
): boolean {
	const versions: readonly string[] =
		FULL_HISTORY_LEDGER_CLOSE_META_SUPPORTED_SCHEMA_VERSIONS[output.dataset];
	return versions.includes(output.schemaVersion);
}
