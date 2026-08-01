import type { PublicRecentTransactions } from './types';
import {
	arrayOf,
	boolean,
	dateTime,
	isRecord,
	lowercaseSha256,
	matches,
	nonEmptyString,
	nonNegativeInteger,
	nullable,
	oneOf,
	positiveInteger,
	unsignedIntegerString
} from './status-live-validator-primitives';

const maximumRecentTransactionRecords = 50;

const validateRecentTransaction = matches({
	createdAt: dateTime,
	feeCharged: unsignedIntegerString,
	hash: lowercaseSha256,
	ledger: unsignedIntegerString,
	operationCount: nonNegativeInteger,
	sourceAccount: nonEmptyString,
	successful: boolean
});

const validateRecentTransactions = matches({
	dataThrough: nullable(dateTime),
	freshness: oneOf('fresh', 'stale', 'unknown'),
	freshnessThresholdMs: positiveInteger,
	generatedAt: dateTime,
	limit: positiveInteger,
	records: arrayOf(validateRecentTransaction, maximumRecentTransactionRecords),
	selectionReason: oneOf(
		'local_history_current',
		'local_history_empty',
		'local_history_behind',
		'live_network_unavailable'
	),
	source: oneOf('live_network', 'local_history'),
	truncated: boolean
});

export function parseExplorerRecentTransactions(
	value: unknown
): PublicRecentTransactions | null {
	if (!validateRecentTransactions(value) || !hasCoherentSelection(value)) {
		return null;
	}
	const source = value;
	return {
		dataThrough: source.dataThrough as string | null,
		freshness: source.freshness as PublicRecentTransactions['freshness'],
		freshnessThresholdMs: source.freshnessThresholdMs as number,
		generatedAt: source.generatedAt as string,
		limit: source.limit as number,
		records: (source.records as readonly unknown[]).map(sanitizeTransaction),
		selectionReason:
			source.selectionReason as PublicRecentTransactions['selectionReason'],
		source: source.source as PublicRecentTransactions['source'],
		truncated: source.truncated as boolean
	};
}

function hasCoherentSelection(
	value: unknown
): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	const limit = value.limit;
	const records = value.records;
	if (
		typeof limit !== 'number' ||
		limit > maximumRecentTransactionRecords ||
		!Array.isArray(records) ||
		records.length > limit
	) {
		return false;
	}
	if (value.freshness === 'unknown' && value.dataThrough !== null) return false;
	if (value.freshness !== 'unknown' && value.dataThrough === null) return false;
	if (value.selectionReason === 'local_history_current') {
		return value.source === 'local_history' && value.freshness === 'fresh';
	}
	if (value.selectionReason === 'live_network_unavailable') {
		return value.source === 'local_history' && value.freshness === 'stale';
	}
	return (
		value.source === 'live_network' &&
		(value.selectionReason === 'local_history_empty' ||
			value.selectionReason === 'local_history_behind')
	);
}

function sanitizeTransaction(
	value: unknown
): PublicRecentTransactions['records'][number] {
	if (!isRecord(value)) {
		throw new Error('Explorer transaction changed shape after validation');
	}
	return {
		createdAt: value.createdAt as string,
		feeCharged: value.feeCharged as string,
		hash: value.hash as string,
		ledger: value.ledger as string,
		operationCount: value.operationCount as number,
		sourceAccount: value.sourceAccount as string,
		successful: value.successful as boolean
	};
}
