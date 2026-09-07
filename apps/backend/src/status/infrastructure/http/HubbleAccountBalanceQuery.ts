import type { HubbleCatalog } from './HubbleWarehouseContracts.js';
import { StrKey } from '@stellar/stellar-sdk';
import type {
	HubbleAccountBalance,
	HubbleAccountBalanceInput,
	HubbleAccountBalancePage
} from './HubbleAccountBalanceContracts.js';
import {
	decodeBalanceCursor,
	encodeBalanceCursor,
	requireBalanceAccount
} from './HubbleAccountBalanceCursor.js';
import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError
} from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export async function queryHubbleAccountBalances(
	executor: HubbleSemanticQueryExecutor,
	input: HubbleAccountBalanceInput,
	catalog: Pick<HubbleCatalog, 'coverage' | 'generatedAt'>
): Promise<HubbleAccountBalancePage> {
	const account = requireBalanceAccount(input.account);
	const after = decodeBalanceCursor(account, input.after);
	const requested = input.limit ?? 100;
	if (!Number.isSafeInteger(requested) || requested < 1 || requested > 200)
		throw new HubbleWarehouseInputError(
			'Balance limit must be between 1 and 200'
		);
	const limit = Math.min(requested, executor.maximumRows);
	const parameters: HubblePreparedParameter[] = [
		{ name: 'account', type: 'String', value: account },
		{ name: 'row_limit', type: 'UInt32', value: String(limit + 1) },
		{
			name: 'include_native',
			type: 'UInt8',
			value: after === null ? '1' : '0'
		},
		{ name: 'after_code', type: 'String', value: after?.code ?? '' },
		{ name: 'after_issuer', type: 'String', value: after?.issuer ?? '' }
	];
	const started = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		accountBalanceSql(executor.database),
		parameters
	);
	if (!Array.isArray(response.data) || response.data.length > limit + 1)
		throw unavailable();
	const rows = response.data.map(mapBalance);
	const hasMore = rows.length > limit,
		balances = rows.slice(0, limit),
		last = balances.at(-1);
	return {
		account,
		balanceScope: 'native-and-issued',
		balances,
		limit,
		elapsedMilliseconds: Math.round((performance.now() - started) * 100) / 100,
		nextCursor:
			hasMore && last !== undefined
				? encodeBalanceCursor(account, {
						kind: last.assetType === 'native' ? 0 : 1,
						code: last.assetCode ?? '',
						issuer: last.assetIssuer ?? ''
					})
				: null,
		coverage: catalog.coverage,
		watermark: {
			mode: 'latest-ingested-observations',
			catalogGeneratedAt: catalog.generatedAt,
			catalogMaximumLedger: catalog.coverage.maximumLedger,
			snapshotPinned: false
		}
	};
}

// Both branches constrain the leading account_id sorting key before aggregation.
// Completed/digest-matched evidence is selected before latest-state/deletion logic.
export function accountBalanceSql(databaseName: string): string {
	const database = quoteHubbleIdentifier(databaseName),
		published = completedHubbleBatchPredicate(databaseName);
	const order = 'tuple(ledger_sequence, _row_number, _ingested_at)';
	return `SELECT * FROM (
	SELECT 0 AS asset_kind, '' AS asset_code, '' AS asset_issuer, 'native' AS asset_type,
		tupleElement(observed,1) AS balance, tupleElement(observed,2) AS buying_liabilities,
		tupleElement(observed,3) AS selling_liabilities, tupleElement(observed,4) AS last_modified_ledger,
		tupleElement(observed,5) AS ledger_sequence, tupleElement(observed,7) AS flags,
		CAST(NULL, 'Nullable(String)') AS trust_line_limit_raw
	FROM (SELECT argMax(tuple(balance,buying_liabilities,selling_liabilities,last_modified_ledger,ledger_sequence,deleted,flags),${order}) AS observed
		FROM ${database}.accounts WHERE account_id = {account:String} AND {include_native:UInt8} = 1
		AND ${published} GROUP BY account_id)
	WHERE tupleElement(observed,6) = false
	UNION ALL
	SELECT 1 AS asset_kind, asset_code, asset_issuer, tupleElement(observed,1) AS asset_type,
		tupleElement(observed,2) AS balance, tupleElement(observed,3) AS buying_liabilities,
		tupleElement(observed,4) AS selling_liabilities, tupleElement(observed,7) AS last_modified_ledger,
		tupleElement(observed,8) AS ledger_sequence, tupleElement(observed,6) AS flags,
		toNullable(toString(tupleElement(observed,5))) AS trust_line_limit_raw
	FROM (SELECT asset_code,asset_issuer,
		argMax(tuple(asset_type,balance,buying_liabilities,selling_liabilities,trust_line_limit,flags,last_modified_ledger,ledger_sequence,deleted),${order}) AS observed
		FROM ${database}.trustlines WHERE account_id = {account:String}
		AND asset_type IN ('credit_alphanum4','credit_alphanum12')
		AND tuple(asset_code,asset_issuer) > tuple({after_code:String},{after_issuer:String})
		AND ${published} GROUP BY asset_code,asset_issuer)
	WHERE tupleElement(observed,9) = false
) ORDER BY asset_kind,asset_code,asset_issuer LIMIT {row_limit:UInt32} FORMAT JSON`;
}

function mapBalance(row: Record<string, unknown>): HubbleAccountBalance {
	const type = row.asset_type;
	if (
		type !== 'native' &&
		type !== 'credit_alphanum4' &&
		type !== 'credit_alphanum12'
	)
		throw unavailable();
	if (
		typeof row.asset_code !== 'string' ||
		typeof row.asset_issuer !== 'string'
	)
		throw unavailable();
	const native = type === 'native';
	if (
		native
			? row.asset_code !== '' || row.asset_issuer !== ''
			: row.asset_code.length < 1 ||
				row.asset_code.length > 12 ||
				!StrKey.isValidEd25519PublicKey(row.asset_issuer)
	)
		throw unavailable();
	const limit = row.trust_line_limit_raw;
	if (limit !== null && (typeof limit !== 'string' || !/^\d+$/.test(limit)))
		throw unavailable();
	return {
		asset: native ? 'native' : row.asset_code + ':' + row.asset_issuer,
		assetType: type,
		assetCode: native ? null : row.asset_code,
		assetIssuer: native ? null : row.asset_issuer,
		balance: numeric(row.balance),
		balanceRaw: null,
		amountPrecision: 'float64-observation',
		buyingLiabilities: numeric(row.buying_liabilities),
		sellingLiabilities: numeric(row.selling_liabilities),
		trustLineLimitRaw: limit,
		flags: integer(row.flags),
		lastModifiedLedger: integer(row.last_modified_ledger),
		observedLedger: integer(row.ledger_sequence)
	};
}
function numeric(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw unavailable();
	return value;
}
function integer(value: unknown): number {
	const number =
		typeof value === 'string' && /^\d+$/.test(value)
			? Number(value)
			: numeric(value);
	if (!Number.isSafeInteger(number) || number < 0) throw unavailable();
	return number;
}
function unavailable(): Error {
	return new HubbleWarehouseUnavailableError(
		'Invalid account-balance warehouse response'
	);
}
