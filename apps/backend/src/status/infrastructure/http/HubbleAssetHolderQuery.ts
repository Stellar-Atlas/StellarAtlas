import type { HubbleCatalog } from './HubbleWarehouseContracts.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
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
	input: HubbleAssetHolderQuery,
	catalog: Pick<HubbleCatalog, 'coverage' | 'generatedAt'>
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
	if (!Array.isArray(response.data) || response.data.length > limit + 1)
		throw new HubbleWarehouseUnavailableError(
			'Incomplete or oversized holder response'
		);
	const holders = [...response.data];
	const hasMore = holders.length > limit;
	const selected = hasMore ? holders.slice(0, limit) : holders;
	return {
		coverage: catalog.coverage,
		watermark: {
			mode: 'latest-ingested-observations',
			catalogGeneratedAt: catalog.generatedAt,
			catalogMaximumLedger: catalog.coverage.maximumLedger,
			snapshotPinned: false
		},
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
SELECT account_id, _latest_balance AS balance,
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
		argMax(ledger_sequence,
			tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_ledger_sequence,
		argMax(deleted, tuple(ledger_sequence, _row_number, _ingested_at))
			AS _latest_deleted
	FROM ${database}.accounts
	WHERE ${published}
		${accountPredicate}
	GROUP BY account_id
)
WHERE _latest_deleted = false AND _latest_balance > 0
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
SELECT account_id, _latest_asset_code AS asset_code,
	_latest_asset_issuer AS asset_issuer, _latest_asset_type AS asset_type,
	_latest_balance AS balance, _latest_trust_line_limit AS trust_line_limit,
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
		AND ${published}
		${accountPredicate}
	GROUP BY account_id
)
WHERE _latest_deleted = false AND _latest_balance > 0
ORDER BY account_id ASC
LIMIT {row_limit:UInt32}
FORMAT JSON`;
}
