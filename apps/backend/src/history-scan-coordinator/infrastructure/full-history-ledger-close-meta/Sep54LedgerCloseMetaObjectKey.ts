import {
	fullHistoryLedgerCloseMetaRange,
	STELLAR_LEDGER_SEQUENCE_MAX,
	type FullHistoryLedgerCloseMetaRange,
	FullHistoryLedgerCloseMetaValidationError
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	SEP54_ZSTD_COMPRESSION,
	type Sep54LedgerCloseMetaConfig
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaSource.js';

export const SEP54_MAX_CONFIG_BYTES = 16 * 1024;
export const SEP54_CONFIG_FILE_NAME = '.config.json';

const requiredConfigKeys = [
	'batchesPerPartition',
	'compression',
	'ledgersPerBatch',
	'networkPassphrase',
	'version'
] as const;

export interface Sep54LedgerCloseMetaObjectLocation {
	readonly batchFileName: string;
	readonly objectKey: string;
	readonly partitionDirectory: string | null;
	readonly range: FullHistoryLedgerCloseMetaRange;
}

export function parseSep54LedgerCloseMetaConfig(
	payload: string | Uint8Array
): Sep54LedgerCloseMetaConfig {
	const byteLength =
		typeof payload === 'string'
			? Buffer.byteLength(payload, 'utf8')
			: payload.byteLength;
	if (byteLength === 0 || byteLength > SEP54_MAX_CONFIG_BYTES) {
		throw configError(
			`SEP-54 config must contain 1-${SEP54_MAX_CONFIG_BYTES} bytes`
		);
	}

	let parsed: unknown;
	try {
		const text =
			typeof payload === 'string'
				? payload
				: new TextDecoder('utf-8', { fatal: true }).decode(payload);
		parsed = JSON.parse(text) as unknown;
	} catch (error) {
		throw configError('SEP-54 config must be valid UTF-8 JSON', error);
	}
	return validateSep54LedgerCloseMetaConfig(parsed);
}

export function validateSep54LedgerCloseMetaConfig(
	value: unknown
): Sep54LedgerCloseMetaConfig {
	if (!isRecord(value))
		throw configError('SEP-54 config must be a JSON object');
	const keys = Object.keys(value).sort();
	if (
		keys.length !== requiredConfigKeys.length ||
		requiredConfigKeys.some((key, index) => key !== keys[index])
	) {
		throw configError('SEP-54 config must contain exactly the required fields');
	}

	const networkPassphrase = boundedText(
		value.networkPassphrase,
		'networkPassphrase',
		1024
	);
	const version = boundedText(value.version, 'version', 64);
	if (value.compression !== SEP54_ZSTD_COMPRESSION) {
		throw configError('SEP-54 compression must be zstd');
	}
	const ledgersPerBatch = configInteger(
		value.ledgersPerBatch,
		'ledgersPerBatch'
	);
	const batchesPerPartition = configInteger(
		value.batchesPerPartition,
		'batchesPerPartition'
	);
	const partitionSpan = BigInt(ledgersPerBatch) * BigInt(batchesPerPartition);
	if (partitionSpan > BigInt(STELLAR_LEDGER_SEQUENCE_MAX) + 1n) {
		throw configError('SEP-54 partition span exceeds the uint32 ledger space');
	}

	return Object.freeze({
		batchesPerPartition,
		compression: SEP54_ZSTD_COMPRESSION,
		ledgersPerBatch,
		networkPassphrase,
		version
	});
}

export function createSep54LedgerCloseMetaObjectKey(
	configInput: Sep54LedgerCloseMetaConfig,
	rangeInput: FullHistoryLedgerCloseMetaRange,
	ledgersPath = ''
): Sep54LedgerCloseMetaObjectLocation {
	const config = validateSep54LedgerCloseMetaConfig(configInput);
	const range = fullHistoryLedgerCloseMetaRange(
		rangeInput.startSequence,
		rangeInput.endSequence
	);
	if (range.startSequence < 2) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-range-mismatch',
			'SEP-54 ledger batches cannot start before ledger 2'
		);
	}
	if (range.ledgerCount !== config.ledgersPerBatch) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-cardinality-mismatch',
			'Batch range cardinality does not match ledgersPerBatch'
		);
	}
	if (range.startSequence % config.ledgersPerBatch !== 0) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-range-mismatch',
			'Batch start is not aligned to the SEP-54 batch geometry'
		);
	}

	const partitionSpan = config.ledgersPerBatch * config.batchesPerPartition;
	const partitionStart =
		Math.floor(range.startSequence / partitionSpan) * partitionSpan;
	const partitionEnd = partitionStart + partitionSpan - 1;
	if (
		partitionEnd > STELLAR_LEDGER_SEQUENCE_MAX ||
		range.endSequence > partitionEnd
	) {
		throw new FullHistoryLedgerCloseMetaValidationError(
			'batch-range-mismatch',
			'Batch range does not fit inside its SEP-54 partition'
		);
	}

	const batchFileName = batchName(config, range);
	const partitionDirectory =
		config.batchesPerPartition === 1
			? null
			: `${reverseHex(partitionStart)}--${partitionStart}-${partitionEnd}`;
	const prefix = normalizeLedgersPath(ledgersPath);
	const segments = [prefix, partitionDirectory, batchFileName].filter(
		(value): value is string => value !== null && value.length > 0
	);
	return Object.freeze({
		batchFileName,
		objectKey: segments.join('/'),
		partitionDirectory,
		range
	});
}

export function createSep54LedgerCloseMetaConfigObjectKey(
	ledgersPath = ''
): string {
	const prefix = normalizeLedgersPath(ledgersPath);
	return prefix.length === 0
		? SEP54_CONFIG_FILE_NAME
		: `${prefix}/${SEP54_CONFIG_FILE_NAME}`;
}

export function parseSep54LedgerCloseMetaObjectKey(
	configInput: Sep54LedgerCloseMetaConfig,
	objectKey: string,
	ledgersPath = ''
): Sep54LedgerCloseMetaObjectLocation {
	const config = validateSep54LedgerCloseMetaConfig(configInput);
	if (typeof objectKey !== 'string' || objectKey.length > 4096) {
		throw pathError();
	}
	const batchPattern =
		config.ledgersPerBatch === 1
			? /(?:^|\/)[0-9A-F]{8}--([0-9]+)\.xdr\.zst$/
			: /(?:^|\/)[0-9A-F]{8}--([0-9]+)-([0-9]+)\.xdr\.zst$/;
	const match = batchPattern.exec(objectKey);
	if (match === null) throw pathError();
	const startSequence = Number(match[1]);
	const endSequence =
		config.ledgersPerBatch === 1 ? startSequence : Number(match[2]);
	const location = createSep54LedgerCloseMetaObjectKey(
		config,
		fullHistoryLedgerCloseMetaRange(startSequence, endSequence),
		ledgersPath
	);
	if (location.objectKey !== objectKey) throw pathError();
	return location;
}

function batchName(
	config: Sep54LedgerCloseMetaConfig,
	range: FullHistoryLedgerCloseMetaRange
): string {
	const stem = `${reverseHex(range.startSequence)}--${range.startSequence}`;
	return config.ledgersPerBatch === 1
		? `${stem}.xdr.zst`
		: `${stem}-${range.endSequence}.xdr.zst`;
}

function reverseHex(sequence: number): string {
	return (STELLAR_LEDGER_SEQUENCE_MAX - sequence)
		.toString(16)
		.toUpperCase()
		.padStart(8, '0');
}

function normalizeLedgersPath(value: string): string {
	if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 2048) {
		throw pathError();
	}
	const normalized = value.replace(/^\/+|\/+$/g, '');
	if (normalized.length === 0) return '';
	const segments = normalized.split('/');
	if (
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment === '.' ||
				segment === '..' ||
				segment.includes('\0')
		)
	) {
		throw pathError();
	}
	return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedText(
	value: unknown,
	field: string,
	maximumBytes: number
): string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		Buffer.byteLength(value, 'utf8') > maximumBytes
	) {
		throw configError(
			`SEP-54 ${field} must be nonempty and at most ${maximumBytes} bytes`
		);
	}
	return value;
}

function configInteger(value: unknown, field: string): number {
	if (
		typeof value !== 'number' ||
		!Number.isSafeInteger(value) ||
		value < 1 ||
		value > STELLAR_LEDGER_SEQUENCE_MAX
	) {
		throw configError(`SEP-54 ${field} must be a positive uint32 integer`);
	}
	return value;
}

function configError(
	message: string,
	cause?: unknown
): FullHistoryLedgerCloseMetaValidationError {
	return new FullHistoryLedgerCloseMetaValidationError(
		'invalid-source-config',
		message,
		cause === undefined ? undefined : { cause }
	);
}

function pathError(): FullHistoryLedgerCloseMetaValidationError {
	return new FullHistoryLedgerCloseMetaValidationError(
		'invalid-ledgers-path',
		'SEP-54 ledgers path contains an invalid object-key segment'
	);
}
