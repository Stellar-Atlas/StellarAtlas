import type {
	PublicExplorerCanonicalCoverage,
	PublicExplorerLocalReadModel
} from './explorer-types';
import {
	sanitizeCanonicalFullHistoryCoverage,
	validateCanonicalFullHistoryCoverage
} from './canonical-history-contract';
import {
	boolean,
	dateTime,
	literal,
	matches,
	nonNegativeInteger,
	nullable,
	oneOf,
	string,
	unsignedIntegerString
} from './status-live-validator-primitives';

const validateExplorerLocalReadModel = matches({
	generatedAt: dateTime,
	indexes: matches({
		assetIndexReady: literal(false),
		contractIndexReady: literal(false),
		operationIndexReady: boolean,
		transactionIndexReady: boolean
	}),
	parsedLedgerHeaders: matches({
		earliestParsedLedger: nullable(unsignedIntegerString),
		latestObservedAt: nullable(dateTime),
		latestParsedLedger: nullable(unsignedIntegerString),
		latestParsedLedgerHash: nullable(string),
		parsedLedgerCount: nonNegativeInteger,
		sourceArchiveCount: nonNegativeInteger
	}),
	source: oneOf(
		'full_history_canonical_repository',
		'parsed_ledger_header_repository'
	),
	transactions: matches({
		canonicalCoverage: nullable(validateCanonicalFullHistoryCoverage),
		localCoverage: boolean,
		message: string,
		source: oneOf('horizon_fallback', 'postgres_canonical')
	})
});

export function parseExplorerLocalReadModel(
	value: unknown
): PublicExplorerLocalReadModel | null {
	if (!validateExplorerLocalReadModel(value)) return null;
	const source = record(value);
	const indexes = record(source.indexes);
	const headers = record(source.parsedLedgerHeaders);
	const transactions = record(source.transactions);
	return {
		generatedAt: stringValue(source.generatedAt),
		indexes: {
			assetIndexReady: false,
			contractIndexReady: false,
			operationIndexReady: booleanValue(indexes.operationIndexReady),
			transactionIndexReady: booleanValue(indexes.transactionIndexReady)
		},
		parsedLedgerHeaders: {
			earliestParsedLedger: nullableString(headers.earliestParsedLedger),
			latestObservedAt: nullableString(headers.latestObservedAt),
			latestParsedLedger: nullableString(headers.latestParsedLedger),
			latestParsedLedgerHash: nullableString(headers.latestParsedLedgerHash),
			parsedLedgerCount: numberValue(headers.parsedLedgerCount),
			sourceArchiveCount: numberValue(headers.sourceArchiveCount)
		},
		source: source.source as PublicExplorerLocalReadModel['source'],
		transactions: {
			canonicalCoverage:
				transactions.canonicalCoverage === null
					? null
					: sanitizeCanonicalCoverage(transactions.canonicalCoverage),
			localCoverage: booleanValue(transactions.localCoverage),
			message: stringValue(transactions.message),
			source:
				transactions.source as PublicExplorerLocalReadModel['transactions']['source']
		}
	};
}

function sanitizeCanonicalCoverage(
	value: unknown
): PublicExplorerCanonicalCoverage {
	return sanitizeCanonicalFullHistoryCoverage(value);
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Explorer read model changed shape after validation');
	}
	return value as Record<string, unknown>;
}

function stringValue(value: unknown): string {
	if (typeof value !== 'string') {
		throw new Error('Explorer read-model string changed after validation');
	}
	return value;
}

function nullableString(value: unknown): string | null {
	return value === null ? null : stringValue(value);
}

function booleanValue(value: unknown): boolean {
	if (typeof value !== 'boolean') {
		throw new Error('Explorer read-model boolean changed after validation');
	}
	return value;
}

function numberValue(value: unknown): number {
	if (typeof value !== 'number') {
		throw new Error('Explorer read-model number changed after validation');
	}
	return value;
}
