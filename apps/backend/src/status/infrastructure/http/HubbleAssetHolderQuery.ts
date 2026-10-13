import type { HubbleCatalog } from './HubbleWarehouseContracts.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import { isHubbleLedgerWindowComplete } from './HubbleLedgerCoverage.js';
import {
	holderIndexSql,
	requireHolderIndex
} from './HubbleHolderIndexQuery.js';
import {
	boundedSemanticLimit,
	quoteHubbleIdentifier,
	type HubbleAssetHolderPage,
	type HubbleAssetHolderQuery,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

type HolderCursor = {
	readonly version: 1;
	readonly asset: string;
	readonly sort: 'account' | 'balance';
	readonly order: 'asc' | 'desc';
	readonly asOfLedger: number | null;
	readonly balanceFilter?: 'positive' | 'all';
	readonly includeDeleted?: boolean;
	readonly accountId: string;
	readonly balance?: string;
};

export async function queryHubbleAssetHolders(
	executor: HubbleSemanticQueryExecutor,
	input: HubbleAssetHolderQuery,
	catalog: Pick<HubbleCatalog, 'coverage' | 'generatedAt'>
): Promise<HubbleAssetHolderPage> {
	const limit = boundedSemanticLimit(input.limit, executor.maximumRows);
	const sort = input.sort ?? 'account';
	const order = input.order ?? 'asc';
	const balanceFilter = input.balanceFilter ?? 'positive';
	const includeDeleted = input.includeDeleted ?? false;
	const asOfLedger = input.asOfLedger;
	if (
		!['account', 'balance'].includes(sort) ||
		!['asc', 'desc'].includes(order) ||
		!['positive', 'all'].includes(balanceFilter)
	)
		throw new HubbleWarehouseInputError('Invalid holder sort or order');
	if (
		asOfLedger !== undefined &&
		(!Number.isSafeInteger(asOfLedger) ||
			asOfLedger < 1 ||
			asOfLedger > 4294967295)
	)
		throw new HubbleWarehouseInputError('as_of_ledger must be a valid ledger');
	const maximumLedger = Number(catalog.coverage.maximumLedger ?? 0);
	if (asOfLedger !== undefined && asOfLedger > maximumLedger)
		throw new HubbleWarehouseInputError(
			'as_of_ledger exceeds the maximum observed ledger'
		);
	const selection = {
		asset:
			input.asset.type === 'native'
				? 'native'
				: input.asset.code + ':' + input.asset.issuer,
		sort,
		order,
		asOfLedger: asOfLedger ?? null,
		balanceFilter,
		includeDeleted
	} as const;
	const cursor = input.after
		? decodeHolderCursor(input.after, selection)
		: undefined;
	const legacyAccountCursor =
		input.after &&
		cursor === undefined &&
		sort === 'account' &&
		order === 'asc' &&
		asOfLedger === undefined &&
		balanceFilter === 'positive' &&
		!includeDeleted
			? input.after
			: undefined;
	if (input.after && cursor === undefined && legacyAccountCursor === undefined)
		throw new HubbleWarehouseInputError('Invalid or mismatched holder cursor');
	const parameters: HubblePreparedParameter[] = [
		{ name: 'row_limit', type: 'UInt32', value: String(limit + 1) }
	];
	if (asOfLedger !== undefined)
		parameters.push({
			name: 'as_of_ledger',
			type: 'UInt32',
			value: String(asOfLedger)
		});
	const accountPredicate = buildAccountPredicate(
		input,
		parameters,
		cursor,
		legacyAccountCursor,
		order
	);
	const cursorPredicate = buildBalanceCursorPredicate(
		cursor,
		parameters,
		order
	);
	const database = quoteHubbleIdentifier(executor.database);
	const published = completedHubbleBatchPredicate(executor.database);
	let indexReady = true;
	if (asOfLedger === undefined) {
		indexReady = await requireHolderIndex(executor, selection.asset);
		parameters.push({
			name: 'asset_key',
			type: 'String',
			value: selection.asset
		});
	}
	const sql =
		asOfLedger === undefined
			? holderIndexSql(
					executor.database,
					accountPredicate,
					cursorPredicate,
					sort,
					order,
					balanceFilter,
					includeDeleted
				)
			: input.asset.type === 'native'
				? nativeHolderSql(
						database,
						accountPredicate,
						cursorPredicate,
						published,
						sort,
						order,
						balanceFilter,
						includeDeleted,
						asOfLedger !== undefined
					)
				: issuedHolderSql(
						database,
						accountPredicate,
						cursorPredicate,
						input,
						parameters,
						published,
						sort,
						order,
						balanceFilter,
						includeDeleted,
						asOfLedger !== undefined
					);
	const startedAt = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	if (!Array.isArray(response.data) || response.data.length > limit + 1)
		throw new HubbleWarehouseUnavailableError(
			'Incomplete or oversized holder response'
		);
	const holders = [...response.data];
	const hasMore = holders.length > limit;
	const selected = hasMore ? holders.slice(0, limit) : holders;
	const last = selected.at(-1);
	return {
		...(asOfLedger === undefined
			? {
					indexedSummary: {
						holderCount: String(response.data[0]?.indexed_holder_count ?? '0'),
						balanceTotal: Number(response.data[0]?.indexed_balance_total ?? 0)
					}
				}
			: {}),
		coverage: catalog.coverage,
		watermark: {
			indexStatus:
				asOfLedger !== undefined
					? 'historical-query'
					: indexReady
						? 'ready'
						: 'building',
			mode: 'latest-ingested-observations',
			catalogGeneratedAt: catalog.generatedAt,
			catalogMaximumLedger: catalog.coverage.maximumLedger,
			snapshotPinned: false,
			selectedLedger: asOfLedger === undefined ? null : String(asOfLedger),
			coverageStatus:
				indexReady &&
				hasContinuousBaseline(catalog.coverage, asOfLedger ?? maximumLedger)
					? 'complete'
					: 'partial_or_unknown',
			balancePrecision: 'source-float64'
		},
		asset: selection.asset,
		elapsedMilliseconds:
			Math.round((performance.now() - startedAt) * 100) / 100,
		holders: selected,
		limit,
		nextCursor:
			hasMore && last
				? legacyAccountCursor !== undefined ||
					(sort === 'account' &&
						order === 'asc' &&
						asOfLedger === undefined &&
						balanceFilter === 'positive' &&
						!includeDeleted)
					? String(last.account_id ?? '')
					: encodeHolderCursor({
							...selection,
							version: 1,
							accountId: String(last.account_id ?? ''),
							...(sort === 'balance'
								? { balance: cursorBalance(last.balance) }
								: {})
						})
				: null
	};
}

function hasContinuousBaseline(
	coverage: HubbleCatalog['coverage'],
	lastLedger: number
): boolean {
	return (
		lastLedger >= 2 &&
		coverage.contiguousFirstLedger === '2' &&
		coverage.contiguousLastLedger !== null &&
		Number(coverage.contiguousLastLedger) >= lastLedger &&
		isHubbleLedgerWindowComplete(coverage, 2, lastLedger)
	);
}

function buildAccountPredicate(
	input: HubbleAssetHolderQuery,
	parameters: HubblePreparedParameter[],
	cursor: HolderCursor | undefined,
	legacyAfter: string | undefined,
	order: 'asc' | 'desc'
): string {
	if (input.account !== undefined) {
		parameters.push({ name: 'account', type: 'String', value: input.account });
		return 'AND account_id = {account:String}';
	}
	if (legacyAfter !== undefined || cursor?.sort === 'account') {
		const after = legacyAfter ?? cursor!.accountId;
		parameters.push({ name: 'after', type: 'String', value: after });
		return `AND account_id ${order === 'asc' ? '>' : '<'} {after:String}`;
	}
	return '';
}

function buildBalanceCursorPredicate(
	cursor: HolderCursor | undefined,
	parameters: HubblePreparedParameter[],
	order: 'asc' | 'desc'
): string {
	if (cursor?.sort !== 'balance') return '';
	parameters.push(
		{ name: 'after_balance', type: 'Float64', value: cursor.balance! },
		{ name: 'after_account', type: 'String', value: cursor.accountId }
	);
	const comparison = order === 'asc' ? '>' : '<';
	return `AND (_latest_balance ${comparison} {after_balance:Float64} OR (_latest_balance = {after_balance:Float64} AND account_id > {after_account:String}))`;
}

function ledgerPredicate(asOf: boolean): string {
	return asOf ? 'AND ledger_sequence <= {as_of_ledger:UInt32}' : '';
}

function ordering(sort: 'account' | 'balance', order: 'asc' | 'desc'): string {
	return sort === 'account'
		? `account_id ${order.toUpperCase()}`
		: `_latest_balance ${order.toUpperCase()}, account_id ASC`;
}

function nativeHolderSql(
	database: string,
	accountPredicate: string,
	cursorPredicate: string,
	published: string,
	sort: 'account' | 'balance',
	order: 'asc' | 'desc',
	balanceFilter: 'positive' | 'all',
	includeDeleted: boolean,
	asOf: boolean
): string {
	const deletionFilter = includeDeleted ? '' : 'AND _latest_deleted = false';
	const balanceClause =
		balanceFilter === 'positive'
			? includeDeleted
				? 'AND (_latest_deleted OR _latest_balance > 0)'
				: 'AND _latest_balance > 0'
			: '';
	return `
SELECT account_id, _latest_balance AS balance, nullIf(_latest_sponsor,'') AS sponsor,
	_latest_sponsor!='' AS sponsored, _latest_deleted AS deleted, _latest_flags AS flags,
	_latest_buying_liabilities AS buying_liabilities,
	_latest_selling_liabilities AS selling_liabilities,
	_latest_last_modified_ledger AS last_modified_ledger,
	_latest_ledger_sequence AS ledger_sequence
FROM (
	SELECT account_id,
		argMax(balance, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_balance,
		argMax(buying_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_buying_liabilities,
		argMax(selling_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_selling_liabilities,
		argMax(last_modified_ledger,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_last_modified_ledger,
		argMax(ifNull(sponsor,''), tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_sponsor,
		argMax(flags, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_flags,
		argMax(ledger_sequence,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_ledger_sequence,
		argMax(deleted, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_deleted
	FROM ${database}.accounts
	WHERE ${published} ${ledgerPredicate(asOf)}
		${accountPredicate}
	GROUP BY account_id
)
WHERE 1 ${deletionFilter} ${balanceClause} ${cursorPredicate}
ORDER BY ${ordering(sort, order)}
LIMIT {row_limit:UInt32}
FORMAT JSON`;
}

function issuedHolderSql(
	database: string,
	accountPredicate: string,
	cursorPredicate: string,
	input: HubbleAssetHolderQuery,
	parameters: HubblePreparedParameter[],
	published: string,
	sort: 'account' | 'balance',
	order: 'asc' | 'desc',
	balanceFilter: 'positive' | 'all',
	includeDeleted: boolean,
	asOf: boolean
): string {
	if (input.asset.type !== 'issued') {
		throw new Error('Issued asset query requires code and issuer');
	}
	const deletionFilter = includeDeleted ? '' : 'AND _latest_deleted = false';
	const balanceClause =
		balanceFilter === 'positive'
			? includeDeleted
				? 'AND (_latest_deleted OR _latest_balance > 0)'
				: 'AND _latest_balance > 0'
			: '';
	parameters.push(
		{ name: 'asset_code', type: 'String', value: input.asset.code },
		{ name: 'asset_issuer', type: 'String', value: input.asset.issuer }
	);
	return `
SELECT account_id, _latest_asset_code AS asset_code,
	_latest_asset_issuer AS asset_issuer, _latest_asset_type AS asset_type,
	_latest_balance AS balance, _latest_trust_line_limit AS trust_line_limit,
	nullIf(_latest_sponsor,'') AS sponsor, _latest_sponsor!='' AS sponsored,
	_latest_deleted AS deleted,
	_latest_buying_liabilities AS buying_liabilities,
	_latest_selling_liabilities AS selling_liabilities, _latest_flags AS flags,
	_latest_last_modified_ledger AS last_modified_ledger,
	_latest_ledger_sequence AS ledger_sequence
FROM (
	SELECT account_id,
		argMax(asset_code, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_asset_code,
		argMax(asset_issuer, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_asset_issuer,
		argMax(asset_type, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_asset_type,
		argMax(balance, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_balance,
		argMax(trust_line_limit,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_trust_line_limit,
		argMax(buying_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_buying_liabilities,
		argMax(selling_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_selling_liabilities,
		argMax(flags, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_flags,
		argMax(ifNull(sponsor,''), tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_sponsor,
		argMax(last_modified_ledger,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_last_modified_ledger,
		argMax(ledger_sequence,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_ledger_sequence,
		argMax(deleted, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_deleted
	FROM ${database}.trustlines
	WHERE asset_code = {asset_code:String}
		AND asset_issuer = {asset_issuer:String}
		AND ${published} ${ledgerPredicate(asOf)}
		${accountPredicate}
	GROUP BY account_id
)
WHERE 1 ${deletionFilter} ${balanceClause} ${cursorPredicate}
ORDER BY ${ordering(sort, order)}
LIMIT {row_limit:UInt32}
FORMAT JSON`;
}

function encodeHolderCursor(cursor: HolderCursor): string {
	return 'c.' + Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeHolderCursor(
	value: string,
	selection: Omit<HolderCursor, 'version' | 'accountId' | 'balance'>
): HolderCursor | undefined {
	if (!value.startsWith('c.')) return undefined;
	try {
		if (value.length > 4096) throw new Error('oversized cursor');
		const parsed = JSON.parse(
			Buffer.from(value.slice(2), 'base64url').toString()
		) as HolderCursor;
		if (
			parsed.version !== 1 ||
			parsed.asset !== selection.asset ||
			parsed.sort !== selection.sort ||
			parsed.order !== selection.order ||
			parsed.asOfLedger !== selection.asOfLedger ||
			(parsed.balanceFilter ?? 'positive') !== selection.balanceFilter ||
			(parsed.includeDeleted ?? false) !== selection.includeDeleted ||
			typeof parsed.accountId !== 'string' ||
			(parsed.sort === 'balance' &&
				(typeof parsed.balance !== 'string' ||
					!isNumericCursor(parsed.balance)))
		)
			throw new Error('invalid cursor');
		return parsed;
	} catch {
		throw new HubbleWarehouseInputError('Invalid or mismatched holder cursor');
	}
}

function cursorBalance(value: unknown): string {
	if (
		(typeof value === 'number' && Number.isFinite(value)) ||
		(typeof value === 'string' && isNumericCursor(value))
	) {
		return String(value);
	}
	throw new HubbleWarehouseUnavailableError(
		'Holder balance cannot be represented by the warehouse cursor'
	);
}

function isNumericCursor(value: string): boolean {
	return (
		/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) &&
		Number.isFinite(Number(value))
	);
}
