import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import {
	boundedSemanticLimit,
	quoteHubbleIdentifier,
	type HubbleAssetHolderPage,
	type HubbleAssetHolderQuery,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export async function queryHubbleAssetHolders(
	executor: HubbleSemanticQueryExecutor,
	input: HubbleAssetHolderQuery
): Promise<HubbleAssetHolderPage> {
	const limit = boundedSemanticLimit(input.limit, executor.maximumRows);
	const parameters: HubblePreparedParameter[] = [
		{ name: 'row_limit', type: 'UInt32', value: String(limit + 1) }
	];
	const accountPredicate = buildAccountPredicate(input, parameters);
	const database = quoteHubbleIdentifier(executor.database);
	const published = completedHubbleBatchPredicate(executor.database);
	const sql =
		input.asset.type === 'native'
			? nativeHolderSql(database, accountPredicate, published)
			: issuedHolderSql(
					database,
					accountPredicate,
					input,
					parameters,
					published
				);
	const startedAt = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	const holders = [...(response.data ?? [])];
	const hasMore = holders.length > limit;
	const selected = hasMore ? holders.slice(0, limit) : holders;
	return {
		asset:
			input.asset.type === 'native'
				? 'native'
				: input.asset.code + ':' + input.asset.issuer,
		elapsedMilliseconds:
			Math.round((performance.now() - startedAt) * 100) / 100,
		holders: selected,
		limit,
		nextCursor:
			hasMore && selected.length > 0
				? String(selected[selected.length - 1]?.account_id ?? '')
				: null
	};
}

function buildAccountPredicate(
	input: HubbleAssetHolderQuery,
	parameters: HubblePreparedParameter[]
): string {
	if (input.account !== undefined) {
		parameters.push({
			name: 'account',
			type: 'String',
			value: input.account
		});
		return 'AND account_id = {account:String}';
	}
	if (input.after !== undefined && input.after !== '') {
		parameters.push({
			name: 'after',
			type: 'String',
			value: input.after
		});
		return 'AND account_id > {after:String}';
	}
	return '';
}

function nativeHolderSql(
	database: string,
	accountPredicate: string,
	published: string
): string {
	return `
SELECT account_id, balance, buying_liabilities, selling_liabilities,
	last_modified_ledger, ledger_sequence
FROM (
	SELECT account_id,
		argMax(balance, tuple(ledger_sequence, _row_number, _ingested_at))
			AS balance,
		argMax(buying_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS buying_liabilities,
		argMax(selling_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS selling_liabilities,
		argMax(last_modified_ledger,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS last_modified_ledger,
		argMax(ledger_sequence,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS ledger_sequence,
		argMax(deleted, tuple(ledger_sequence, _row_number, _ingested_at))
			AS deleted
	FROM ${database}.accounts
	WHERE ${published}
		${accountPredicate}
	GROUP BY account_id
)
WHERE deleted = false AND balance > 0
ORDER BY account_id ASC
LIMIT {row_limit:UInt32}
FORMAT JSON`;
}

function issuedHolderSql(
	database: string,
	accountPredicate: string,
	input: HubbleAssetHolderQuery,
	parameters: HubblePreparedParameter[],
	published: string
): string {
	if (input.asset.type !== 'issued') {
		throw new Error('Issued asset query requires code and issuer');
	}
	parameters.push(
		{ name: 'asset_code', type: 'String', value: input.asset.code },
		{ name: 'asset_issuer', type: 'String', value: input.asset.issuer }
	);
	return `
SELECT account_id, asset_code, asset_issuer, asset_type, balance,
	trust_line_limit, buying_liabilities, selling_liabilities, flags,
	last_modified_ledger, ledger_sequence
FROM (
	SELECT account_id,
		argMax(asset_code, tuple(ledger_sequence, _row_number, _ingested_at))
			AS asset_code,
		argMax(asset_issuer, tuple(ledger_sequence, _row_number, _ingested_at))
			AS asset_issuer,
		argMax(asset_type, tuple(ledger_sequence, _row_number, _ingested_at))
			AS asset_type,
		argMax(balance, tuple(ledger_sequence, _row_number, _ingested_at))
			AS balance,
		argMax(trust_line_limit,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS trust_line_limit,
		argMax(buying_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS buying_liabilities,
		argMax(selling_liabilities,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS selling_liabilities,
		argMax(flags, tuple(ledger_sequence, _row_number, _ingested_at))
			AS flags,
		argMax(last_modified_ledger,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS last_modified_ledger,
		argMax(ledger_sequence,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS ledger_sequence,
		argMax(deleted, tuple(ledger_sequence, _row_number, _ingested_at))
			AS deleted
	FROM ${database}.trustlines
	WHERE asset_code = {asset_code:String}
		AND asset_issuer = {asset_issuer:String}
		AND ${published}
		${accountPredicate}
	GROUP BY account_id
)
WHERE deleted = false AND balance > 0
ORDER BY account_id ASC
LIMIT {row_limit:UInt32}
FORMAT JSON`;
}
