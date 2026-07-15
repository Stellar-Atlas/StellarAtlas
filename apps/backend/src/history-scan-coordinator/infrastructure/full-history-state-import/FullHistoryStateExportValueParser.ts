import type {
	FullHistoryAccountStateChange,
	FullHistoryStateChangeProvenance,
	FullHistoryStateDataset,
	FullHistoryTrustlineStateChange
} from '../../domain/full-history-state-import/FullHistoryStateExport.js';

type JsonRecord = Readonly<Record<string, unknown>>;

const signed64Minimum = -(1n << 63n);
const signed64Maximum = (1n << 63n) - 1n;
const unsigned64Maximum = (1n << 64n) - 1n;
const commonKeys = [
	'changeIndex',
	'changeType',
	'changeTypeString',
	'closedAtUnixMillis',
	'deleted',
	'lastModifiedLedger',
	'ledgerKeySha256',
	'ledgerSequence',
	'operationIndex',
	'reason',
	'sponsor',
	'stateEntryXdrBase64',
	'transactionHash',
	'transactionIndex',
	'upgradeIndex'
] as const;
const accountKeys = [
	...commonKeys,
	'accountId',
	'balance',
	'buyingLiabilities',
	'flags',
	'highThreshold',
	'homeDomain',
	'inflationDestination',
	'lowThreshold',
	'masterWeight',
	'mediumThreshold',
	'sequenceLedger',
	'sequenceNumber',
	'sequenceTime',
	'signerCount',
	'signerKeys',
	'signerSponsors',
	'signerWeights',
	'sellingLiabilities',
	'sponsoredEntryCount',
	'sponsoringEntryCount',
	'subentryCount'
] as const;
const trustlineKeys = [
	...commonKeys,
	'accountId',
	'assetCode',
	'assetIssuer',
	'assetType',
	'assetTypeString',
	'balance',
	'buyingLiabilities',
	'flags',
	'limit',
	'liquidityPoolId',
	'liquidityPoolUseCount',
	'sellingLiabilities'
] as const;
const reasons = new Set([
	'fee',
	'fee_refund',
	'operation',
	'transaction',
	'upgrade'
]);

export function parseFullHistoryStateChange(
	dataset: FullHistoryStateDataset,
	value: unknown
): FullHistoryAccountStateChange | FullHistoryTrustlineStateChange {
	const record = readRecord(value, 'state change');
	return dataset === 'account-state-changes'
		? parseAccount(record)
		: parseTrustline(record);
}

function parseAccount(record: JsonRecord): FullHistoryAccountStateChange {
	assertExactKeys(record, accountKeys, 'account state change');
	const common = parseCommon(record);
	const signerKeys = readStringArray(record, 'signerKeys', 128);
	const signerWeights = readInt32Array(record, 'signerWeights', 0, 255);
	const signerSponsors = readNullableStringArray(record, 'signerSponsors', 128);
	const signerCount = readDecimal(record, 'signerCount', 0n, signed64Maximum);
	if (
		BigInt(signerCount) !== BigInt(signerKeys.length) ||
		signerKeys.length !== signerWeights.length ||
		signerKeys.length !== signerSponsors.length
	) {
		throw new TypeError('Account signer arrays do not match signerCount');
	}
	const sequenceLedger = readNullableDecimal(
		record,
		'sequenceLedger',
		0n,
		unsigned64Maximum
	);
	const sequenceTime = readNullableDecimal(
		record,
		'sequenceTime',
		0n,
		unsigned64Maximum
	);
	if ((sequenceLedger === null) !== (sequenceTime === null)) {
		throw new TypeError('Account sequence metadata must be wholly present');
	}
	return Object.freeze({
		...common,
		accountId: readString(record, 'accountId', 128, false),
		balance: readDecimal(record, 'balance', signed64Minimum, signed64Maximum),
		buyingLiabilities: readDecimal(
			record,
			'buyingLiabilities',
			signed64Minimum,
			signed64Maximum
		),
		flags: readDecimal(record, 'flags', 0n, unsigned64Maximum),
		highThreshold: readInt32(record, 'highThreshold', 0, 255),
		homeDomain: readString(record, 'homeDomain', 32, true),
		inflationDestination: readNullableString(
			record,
			'inflationDestination',
			128
		),
		lowThreshold: readInt32(record, 'lowThreshold', 0, 255),
		masterWeight: readInt32(record, 'masterWeight', 0, 255),
		mediumThreshold: readInt32(record, 'mediumThreshold', 0, 255),
		sequenceLedger,
		sequenceNumber: readDecimal(
			record,
			'sequenceNumber',
			signed64Minimum,
			signed64Maximum
		),
		sequenceTime,
		signerCount,
		signerKeys,
		signerSponsors,
		signerWeights,
		sellingLiabilities: readDecimal(
			record,
			'sellingLiabilities',
			signed64Minimum,
			signed64Maximum
		),
		sponsoredEntryCount: readDecimal(
			record,
			'sponsoredEntryCount',
			0n,
			signed64Maximum
		),
		sponsoringEntryCount: readDecimal(
			record,
			'sponsoringEntryCount',
			0n,
			signed64Maximum
		),
		subentryCount: readDecimal(record, 'subentryCount', 0n, signed64Maximum)
	});
}

function parseTrustline(record: JsonRecord): FullHistoryTrustlineStateChange {
	assertExactKeys(record, trustlineKeys, 'trustline state change');
	const assetCode = readString(record, 'assetCode', 12, true);
	const assetIssuer = readString(record, 'assetIssuer', 128, true);
	const liquidityPoolId = readString(record, 'liquidityPoolId', 64, true);
	if (
		(liquidityPoolId.length > 0 &&
			(assetCode.length > 0 || assetIssuer.length > 0)) ||
		(liquidityPoolId.length === 0 &&
			(assetCode.length === 0 || assetIssuer.length === 0))
	) {
		throw new TypeError('Trustline asset identity is incoherent');
	}
	return Object.freeze({
		...parseCommon(record),
		accountId: readString(record, 'accountId', 128, false),
		assetCode,
		assetIssuer,
		assetType: readInt32(record, 'assetType', 0),
		assetTypeString: readString(record, 'assetTypeString', 64, false),
		balance: readDecimal(record, 'balance', signed64Minimum, signed64Maximum),
		buyingLiabilities: readDecimal(
			record,
			'buyingLiabilities',
			signed64Minimum,
			signed64Maximum
		),
		flags: readDecimal(record, 'flags', 0n, unsigned64Maximum),
		limit: readDecimal(record, 'limit', signed64Minimum, signed64Maximum),
		liquidityPoolId,
		liquidityPoolUseCount: readInt32(record, 'liquidityPoolUseCount', 0),
		sellingLiabilities: readDecimal(
			record,
			'sellingLiabilities',
			signed64Minimum,
			signed64Maximum
		)
	});
}

function parseCommon(record: JsonRecord): FullHistoryStateChangeProvenance {
	const reason = readString(record, 'reason', 32, false);
	if (!reasons.has(reason)) throw new TypeError('Unknown state change reason');
	const transactionHash = readString(record, 'transactionHash', 64, true);
	if (transactionHash.length > 0 && !/^[0-9a-f]{64}$/.test(transactionHash)) {
		throw new TypeError('transactionHash must be lowercase SHA-256 hex');
	}
	const ledgerKeySha256 = readString(record, 'ledgerKeySha256', 64, false);
	if (!/^[0-9a-f]{64}$/.test(ledgerKeySha256)) {
		throw new TypeError('ledgerKeySha256 must be lowercase SHA-256 hex');
	}
	const changeIndex = readDecimal(record, 'changeIndex', 1n, unsigned64Maximum);
	const operationIndex = readNullableDecimal(
		record,
		'operationIndex',
		1n,
		unsigned64Maximum
	);
	const transactionIndex = readDecimal(
		record,
		'transactionIndex',
		0n,
		unsigned64Maximum
	);
	const upgradeIndex = readNullableDecimal(
		record,
		'upgradeIndex',
		1n,
		unsigned64Maximum
	);
	assertProvenance(
		reason,
		transactionHash,
		transactionIndex,
		operationIndex,
		upgradeIndex
	);
	return Object.freeze({
		changeIndex,
		changeType: readInt32(record, 'changeType', 0),
		changeTypeString: readString(record, 'changeTypeString', 64, false),
		closedAtUnixMillis: readDecimal(
			record,
			'closedAtUnixMillis',
			0n,
			signed64Maximum
		),
		deleted: readBoolean(record, 'deleted'),
		lastModifiedLedger: readDecimal(
			record,
			'lastModifiedLedger',
			0n,
			unsigned64Maximum
		),
		ledgerKeySha256,
		ledgerSequence: readDecimal(
			record,
			'ledgerSequence',
			1n,
			unsigned64Maximum
		),
		operationIndex,
		reason,
		sponsor: readNullableString(record, 'sponsor', 128),
		stateEntryXdrBase64: readCanonicalBase64(record, 'stateEntryXdrBase64'),
		transactionHash,
		transactionIndex,
		upgradeIndex
	});
}

function assertProvenance(
	reason: string,
	transactionHash: string,
	transactionIndex: string,
	operationIndex: string | null,
	upgradeIndex: string | null
): void {
	const isTransaction = BigInt(transactionIndex) > 0n;
	const valid =
		reason === 'upgrade'
			? !isTransaction &&
				transactionHash.length === 0 &&
				operationIndex === null &&
				upgradeIndex !== null
			: isTransaction &&
				transactionHash.length === 64 &&
				upgradeIndex === null &&
				(reason === 'operation'
					? operationIndex !== null
					: operationIndex === null);
	if (!valid) throw new TypeError('State change provenance is incoherent');
}

function readRecord(value: unknown, name: string): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object`);
	}
	return value as JsonRecord;
}

function assertExactKeys(
	record: JsonRecord,
	expected: readonly string[],
	name: string
): void {
	const actual = Object.keys(record).sort();
	const sortedExpected = [...expected].sort();
	if (
		actual.length !== sortedExpected.length ||
		actual.some((key, index) => key !== sortedExpected[index])
	) {
		throw new TypeError(`${name} has an unexpected field set`);
	}
}

function readString(
	record: JsonRecord,
	key: string,
	maximumBytes: number,
	allowEmpty: boolean
): string {
	const value = record[key];
	if (
		typeof value !== 'string' ||
		(!allowEmpty && value.length === 0) ||
		Buffer.byteLength(value, 'utf8') > maximumBytes
	) {
		throw new TypeError(`${key} is invalid`);
	}
	return value;
}

function readNullableString(
	record: JsonRecord,
	key: string,
	maximumBytes: number
): string | null {
	return record[key] === null
		? null
		: readString(record, key, maximumBytes, false);
}

function readDecimal(
	record: JsonRecord,
	key: string,
	minimum: bigint,
	maximum: bigint
): string {
	const value = readString(record, key, 32, false);
	if (!/^-?(0|[1-9][0-9]*)$/.test(value)) {
		throw new TypeError(`${key} must be a canonical decimal string`);
	}
	const parsed = BigInt(value);
	if (parsed < minimum || parsed > maximum) {
		throw new TypeError(`${key} is outside its integer range`);
	}
	return value;
}

function readNullableDecimal(
	record: JsonRecord,
	key: string,
	minimum: bigint,
	maximum: bigint
): string | null {
	return record[key] === null
		? null
		: readDecimal(record, key, minimum, maximum);
}

function readInt32(
	record: JsonRecord,
	key: string,
	minimum = -(2 ** 31),
	maximum = 2 ** 31 - 1
): number {
	const value = record[key];
	if (
		typeof value !== 'number' ||
		!Number.isInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new TypeError(`${key} must be an int32`);
	}
	return value;
}

function readBoolean(record: JsonRecord, key: string): boolean {
	const value = record[key];
	if (typeof value !== 'boolean') throw new TypeError(`${key} must be boolean`);
	return value;
}

function readStringArray(
	record: JsonRecord,
	key: string,
	maximumBytes: number
): readonly string[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new TypeError(`${key} must be an array`);
	return Object.freeze(
		value.map((item) =>
			readString({ value: item }, 'value', maximumBytes, false)
		)
	);
}

function readNullableStringArray(
	record: JsonRecord,
	key: string,
	maximumBytes: number
): readonly (string | null)[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new TypeError(`${key} must be an array`);
	return Object.freeze(
		value.map((item) =>
			item === null
				? null
				: readString({ value: item }, 'value', maximumBytes, false)
		)
	);
}

function readInt32Array(
	record: JsonRecord,
	key: string,
	minimum: number,
	maximum: number
): readonly number[] {
	const value = record[key];
	if (!Array.isArray(value)) throw new TypeError(`${key} must be an array`);
	return Object.freeze(
		value.map((item) => readInt32({ value: item }, 'value', minimum, maximum))
	);
}

function readCanonicalBase64(record: JsonRecord, key: string): string {
	const value = readString(record, key, 1 << 20, false);
	if (
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			value
		)
	) {
		throw new TypeError(`${key} must be canonical base64`);
	}
	const decoded = Buffer.from(value, 'base64');
	if (decoded.byteLength === 0 || decoded.toString('base64') !== value) {
		throw new TypeError(`${key} must encode non-empty XDR bytes`);
	}
	return value;
}
