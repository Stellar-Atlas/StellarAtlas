export interface GoFullHistoryLedgerCloseMetaFormat {
	readonly canonicalLedgerCloseMetaEncoding: 'xdr+zstd';
	readonly name: 'stellar-atlas-full-history-shard';
	readonly parquetCompression: 'zstd';
	readonly parquetWriter: 'github.com/xitongsys/parquet-go@v1.6.2';
	readonly partitionColumns: readonly ['ledger_sequence'];
	readonly stellarSdk: 'github.com/stellar/go-stellar-sdk@v0.6.0';
	readonly stellarXdrCommit: '68fa1ac55692f68ad2a2ca549d0a283273554439';
}

export interface GoFullHistoryLedgerCloseMetaLimits {
	readonly maxCompressedBytes: number;
	readonly maxDecodedMemoryBytes: number;
	readonly maxLedgers: number;
	readonly maxOutputBytes: number;
	readonly maxRows: number;
	readonly maxUncompressedBytes: number;
}

const maximumShardLedgers = 1_024;
const canonicalUtcTimestampPattern =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const formatKeys = [
	'canonicalLedgerCloseMetaEncoding',
	'name',
	'parquetCompression',
	'parquetWriter',
	'partitionColumns',
	'stellarSdk',
	'stellarXdrCommit'
] as const;
const limitKeys = [
	'maxCompressedBytes',
	'maxDecodedMemoryBytes',
	'maxLedgers',
	'maxOutputBytes',
	'maxRows',
	'maxUncompressedBytes'
] as const;

export function parseManifestCreatedAt(value: unknown): string {
	if (typeof value !== 'string') {
		throw new TypeError('createdAt must be a canonical UTC timestamp');
	}
	const match = canonicalUtcTimestampPattern.exec(value);
	if (match === null || (match[7]?.endsWith('0') ?? false)) {
		throw new TypeError('createdAt must be a canonical UTC timestamp');
	}
	const [year, month, day, hour, minute, second] = match
		.slice(1, 7)
		.map(Number) as [number, number, number, number, number, number];
	const milliseconds = Number((match[7] ?? '').padEnd(3, '0').slice(0, 3));
	const timestamp = new Date(0);
	timestamp.setUTCFullYear(year, month - 1, day);
	timestamp.setUTCHours(hour, minute, second, milliseconds);
	if (
		timestamp.getUTCFullYear() !== year ||
		timestamp.getUTCMonth() !== month - 1 ||
		timestamp.getUTCDate() !== day ||
		timestamp.getUTCHours() !== hour ||
		timestamp.getUTCMinutes() !== minute ||
		timestamp.getUTCSeconds() !== second ||
		timestamp.getUTCMilliseconds() !== milliseconds
	) {
		throw new TypeError('createdAt must be a canonical UTC timestamp');
	}
	return value;
}

export function parseManifestFormat(
	value: unknown
): GoFullHistoryLedgerCloseMetaFormat {
	const row = exactObjectValue(value, 'format', formatKeys);
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

export function parseManifestLimits(
	value: unknown
): GoFullHistoryLedgerCloseMetaLimits {
	const row = exactObjectValue(value, 'limits', limitKeys);
	const limits = Object.freeze({
		maxCompressedBytes: safeInteger(
			row.maxCompressedBytes,
			'limits.maxCompressedBytes',
			1
		),
		maxDecodedMemoryBytes: safeInteger(
			row.maxDecodedMemoryBytes,
			'limits.maxDecodedMemoryBytes',
			1
		),
		maxLedgers: safeInteger(row.maxLedgers, 'limits.maxLedgers', 1),
		maxOutputBytes: safeInteger(row.maxOutputBytes, 'limits.maxOutputBytes', 1),
		maxRows: safeInteger(row.maxRows, 'limits.maxRows', 1),
		maxUncompressedBytes: safeInteger(
			row.maxUncompressedBytes,
			'limits.maxUncompressedBytes',
			1
		)
	});
	if (limits.maxLedgers > maximumShardLedgers) {
		throw new TypeError(`limits.maxLedgers must be <= ${maximumShardLedgers}`);
	}
	return limits;
}

export function exactObjectValue<const Keys extends readonly string[]>(
	value: unknown,
	field: string,
	expectedKeys: Keys
): Readonly<Record<Keys[number], unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${field} must be an object`);
	}
	const row = value as Readonly<Record<PropertyKey, unknown>>;
	const expected = new Set<string>(expectedKeys);
	for (const key of Reflect.ownKeys(row)) {
		if (typeof key !== 'string' || !expected.has(key)) {
			throw new TypeError(`${field} has unknown key ${String(key)}`);
		}
	}
	for (const key of expectedKeys) {
		if (!Object.hasOwn(row, key)) {
			throw new TypeError(`${field}.${key} is required`);
		}
	}
	return row as Readonly<Record<Keys[number], unknown>>;
}

export function boundedString(
	value: unknown,
	field: string,
	maximum: number
): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximum) {
		throw new TypeError(`${field} must be a non-empty bounded string`);
	}
	return value;
}

export function exactString<const Expected extends string>(
	value: unknown,
	field: string,
	expected: Expected
): Expected {
	if (value !== expected) {
		throw new TypeError(`${field} is not compatible with this service`);
	}
	return expected;
}

export function exactStringArray<const Expected extends readonly string[]>(
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

export function safeInteger(
	value: unknown,
	field: string,
	minimum: number
): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) {
		throw new TypeError(`${field} must be a safe integer >= ${minimum}`);
	}
	return value as number;
}
