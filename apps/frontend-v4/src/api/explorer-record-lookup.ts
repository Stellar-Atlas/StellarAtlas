import { normalizeWarehouseTimestamp } from './explorer-analytics';
import type { PublicExplorerLedger, PublicExplorerSearch } from './types';
import type { ExplorerSearchResult } from '../app/actions/network-data';
import { recordValue } from './explorer-analytics';

export function buildAnalyticsLedgerPath(sequence: string): string {
	return `/v1/analytics/ledgers/${encodeURIComponent(sequence)}`;
}

/** Validate and adapt the parsed warehouse-ledger response to the shared lookup result view. */
export function parseAnalyticsLedgerLookup(
	sequence: string,
	value: unknown,
	observedAt = new Date().toISOString()
): ExplorerSearchResult {
	const ledger = recordValue(recordValue(value).ledger);
	const actualSequence = ledger.sequence;
	if (
		String(actualSequence) !== sequence ||
		typeof ledger.ledger_hash !== 'string' ||
		!/^[a-f\d]{64}$/i.test(ledger.ledger_hash) ||
		typeof ledger.closed_at !== 'string' ||
		!Number.isFinite(
			Date.parse(normalizeWarehouseTimestamp(ledger.closed_at))
		) ||
		!nonnegativeInteger(ledger.operation_count) ||
		!nonnegativeInteger(ledger.protocol_version) ||
		!(
			ledger.transaction_count === null ||
			nonnegativeInteger(ledger.transaction_count)
		)
	)
		throw new Error('The data service returned invalid ledger metadata.');

	const parsed: PublicExplorerLedger = {
		sequence,
		hash: ledger.ledger_hash,
		closedAt: normalizeWarehouseTimestamp(ledger.closed_at),
		operationCount: ledger.operation_count,
		protocolVersion: ledger.protocol_version,
		transactionCount: ledger.transaction_count,
		source: 'analytics_warehouse'
	};
	const search: PublicExplorerSearch = {
		query: sequence,
		result: parsed,
		resultType: 'ledger',
		source: 'analytics_warehouse'
	};
	return { message: null, observedAt, search, status: 'loaded' };
}

function nonnegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
