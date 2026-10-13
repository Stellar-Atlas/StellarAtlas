import { recordValue, requestExplorerJson } from './explorer-analytics';

export type BalanceObservationKind = 'balances' | 'holders';
export interface BalanceObservationRow {
	readonly id: string;
	readonly balance: number;
	readonly buyingLiabilities: number;
	readonly sellingLiabilities: number;
	readonly observedLedger: number;
	readonly lastModifiedLedger: number;
	readonly trustLineLimit: string | null;
	readonly sponsor?: string | null;
	readonly deleted?: boolean;
}
export interface BalanceObservationPage {
	readonly indexedHolderCount?: string;
	readonly indexedBalanceTotal?: number;
	readonly indexStatus?: string;
	readonly rows: readonly BalanceObservationRow[];
	readonly nextCursor: string | null;
	readonly catalogGeneratedAt: string;
	readonly maximumLedger: string | null;
	readonly totalLedgerCount: string;
	readonly contiguousLastLedger: string | null;
	readonly gapCount: number;
	readonly selectedLedger?: string | null;
	readonly coverageStatus?: 'complete' | 'partial_or_unknown';
}
export interface BalanceObservationOptions {
	readonly sort?: 'account' | 'balance';
	readonly order?: 'asc' | 'desc';
	readonly asOfLedger?: string;
	readonly includeZero?: boolean;
}

export function balanceObservationPath(
	kind: BalanceObservationKind,
	identifier: string,
	after: string | null,
	options?: BalanceObservationOptions
): string {
	const query = new URLSearchParams({ limit: '25' });
	if (after !== null) query.set('after', after);
	if (kind === 'holders' && options) {
		if (options.sort) query.set('sort', options.sort);
		if (options.order) query.set('order', options.order);
		if (options.asOfLedger) query.set('as_of_ledger', options.asOfLedger);
	}
	const base = kind === 'holders' && options ? '/v1' : '/v1/analytics';
	return `${base}/${kind === 'balances' ? 'accounts' : 'assets'}/${encodeURIComponent(identifier)}/${kind === 'holders' && options?.includeZero ? 'balances' : kind}?${query}`;
}

function invalid(): never {
	throw new Error(
		'The data service returned invalid balance observation metadata.'
	);
}
function decimalString(value: unknown, nullable = false): string | null {
	if (value === null && nullable) return null;
	return typeof value === 'string' && /^\d+$/.test(value) ? value : invalid();
}
function finiteNumber(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: invalid();
}
function ledger(value: unknown): number {
	const number =
		typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
	return typeof number === 'number' &&
		Number.isSafeInteger(number) &&
		number >= 0 &&
		number <= 4294967295
		? number
		: invalid();
}
function parseRow(
	kind: BalanceObservationKind,
	value: unknown
): BalanceObservationRow {
	const row = recordValue(value),
		balances = kind === 'balances';
	const id = balances ? row.asset : row.account_id;
	if (typeof id !== 'string' || id.length === 0) invalid();
	if (
		balances &&
		(row.amountPrecision !== 'float64-observation' || row.balanceRaw !== null)
	)
		invalid();
	const limit = balances ? row.trustLineLimitRaw : row.trust_line_limit;
	return {
		id,
		sponsor: typeof row.sponsor === 'string' ? row.sponsor : null,
		deleted: row.deleted === true,
		balance: finiteNumber(row.balance),
		buyingLiabilities: finiteNumber(
			balances ? row.buyingLiabilities : row.buying_liabilities
		),
		sellingLiabilities: finiteNumber(
			balances ? row.sellingLiabilities : row.selling_liabilities
		),
		observedLedger: ledger(balances ? row.observedLedger : row.ledger_sequence),
		lastModifiedLedger: ledger(
			balances ? row.lastModifiedLedger : row.last_modified_ledger
		),
		trustLineLimit:
			limit === undefined || limit === null
				? null
				: typeof limit === 'string' || typeof limit === 'number'
					? String(limit)
					: invalid()
	};
}

export function parseBalanceObservationPage(
	kind: BalanceObservationKind,
	identifier: string,
	value: unknown
): BalanceObservationPage {
	const data = recordValue(value),
		watermark = recordValue(data.watermark),
		coverage = recordValue(data.coverage);
	const rows = data[kind];
	const indexedSummary = recordValue(data.indexedSummary);
	if (
		data[kind === 'balances' ? 'account' : 'asset'] !== identifier ||
		!Array.isArray(rows) ||
		rows.length > 25 ||
		watermark.mode !== 'latest-ingested-observations' ||
		watermark.snapshotPinned !== false ||
		typeof watermark.catalogGeneratedAt !== 'string' ||
		!Number.isFinite(Date.parse(watermark.catalogGeneratedAt)) ||
		(data.nextCursor !== null &&
			(typeof data.nextCursor !== 'string' ||
				data.nextCursor.length === 0 ||
				data.nextCursor.length > 4096))
	)
		invalid();
	if (!Number.isSafeInteger(coverage.gapCount) || Number(coverage.gapCount) < 0)
		invalid();
	return {
		indexedHolderCount:
			typeof indexedSummary.holderCount === 'string'
				? indexedSummary.holderCount
				: undefined,
		indexedBalanceTotal:
			typeof indexedSummary.balanceTotal === 'number' &&
			Number.isFinite(indexedSummary.balanceTotal)
				? indexedSummary.balanceTotal
				: undefined,
		indexStatus:
			typeof watermark.indexStatus === 'string'
				? watermark.indexStatus
				: undefined,
		rows: rows.map((row) => parseRow(kind, row)),
		nextCursor: data.nextCursor,
		catalogGeneratedAt: watermark.catalogGeneratedAt,
		maximumLedger: decimalString(watermark.catalogMaximumLedger, true),
		totalLedgerCount: decimalString(coverage.totalLedgerCount)!,
		contiguousLastLedger: decimalString(coverage.contiguousLastLedger, true),
		gapCount: Number(coverage.gapCount),
		selectedLedger: decimalString(watermark.selectedLedger ?? null, true),
		coverageStatus:
			watermark.coverageStatus === 'complete'
				? 'complete'
				: 'partial_or_unknown'
	};
}

export async function fetchBalanceObservations(
	kind: BalanceObservationKind,
	identifier: string,
	after: string | null,
	signal: AbortSignal,
	options?: BalanceObservationOptions
): Promise<BalanceObservationPage> {
	const page = parseBalanceObservationPage(
		kind,
		identifier,
		await requestExplorerJson(
			balanceObservationPath(kind, identifier, after, options),
			signal
		)
	);
	if (after !== null && page.nextCursor === after) invalid();
	return page;
}
