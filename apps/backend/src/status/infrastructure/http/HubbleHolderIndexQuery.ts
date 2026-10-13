import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

/** Query only the compact current-state read model, never the historical facts. */
export async function requireHolderIndex(
	executor: HubbleSemanticQueryExecutor,
	asset: string
): Promise<boolean> {
	const database = quoteHubbleIdentifier(executor.database);
	const result = await executor.execute<{ ready: number }>(
		`
SELECT countIf(status = 'ready') AS ready
FROM ${database}._asset_holder_index_assets FINAL
WHERE asset_key IN ({asset_key:String}, '*') FORMAT JSON`,
		[{ name: 'asset_key', type: 'String', value: asset }]
	);
	if (Number(result.data?.[0]?.ready)) return true;
	const available = await executor.execute<{ rows: string }>(
		`SELECT count() AS rows FROM ${database}._asset_holder_current WHERE asset_key={asset_key:String} FORMAT JSON`,
		[{ name: 'asset_key', type: 'String', value: asset }]
	);
	if (!Number(available.data?.[0]?.rows))
		throw new HubbleWarehouseUnavailableError(
			'Holder index is building for this asset.'
		);
	return false;
}

export function holderIndexSql(
	databaseName: string,
	accountPredicate: string,
	cursorPredicate: string,
	sort: 'account' | 'balance',
	order: 'asc' | 'desc',
	balanceFilter: 'positive' | 'all' = 'positive',
	includeDeleted = false
): string {
	const database = quoteHubbleIdentifier(databaseName);
	const published = completedHubbleBatchPredicate(databaseName)
		.replaceAll('_batch_id', 'tupleElement(state,12)')
		.replaceAll('_source_sha256', 'tupleElement(state,13)');
	const ordering =
		sort === 'account'
			? `account_id ${order.toUpperCase()}`
			: `_latest_balance ${order.toUpperCase()}, account_id ASC`;
	const liveFilter = includeDeleted ? '' : 'AND tupleElement(state,9)=false';
	const balanceClause =
		balanceFilter === 'positive'
			? includeDeleted
				? 'AND (tupleElement(state,9)=true OR tupleElement(state,4)>0)'
				: 'AND tupleElement(state,4)>0'
			: '';
	return `WITH snapshot AS (
		SELECT account_id, max(state) AS state FROM ${database}._asset_holder_current
		WHERE asset_key = {asset_key:String} GROUP BY account_id
	), valid AS (
		SELECT *, (${published}) AS published FROM snapshot
	), health AS (
		SELECT throwIf(countIf(NOT published)>0, 'Holder index source visibility changed; reconciliation required') AS guard FROM valid
	), balances AS (
		SELECT account_id, tupleElement(state,4) AS _latest_balance,
			nullIf(tupleElement(state,14),'') AS sponsor,
			toBool(tupleElement(state,14)!='') AS sponsored,
			tupleElement(state,9) AS deleted,
			tupleElement(state,5) AS buying_liabilities, tupleElement(state,6) AS selling_liabilities,
			toString(tupleElement(state,7)) AS trust_line_limit, tupleElement(state,8) AS flags,
			tupleElement(state,10) AS last_modified_ledger, tupleElement(state,1) AS ledger_sequence
		FROM valid CROSS JOIN health WHERE guard=0 ${liveFilter} ${balanceClause}
	), summarized AS (SELECT *, toString(count() OVER ()) AS indexed_holder_count, sum(_latest_balance) OVER () AS indexed_balance_total FROM balances)
	SELECT *, _latest_balance AS balance FROM summarized WHERE 1 ${accountPredicate} ${cursorPredicate}
	ORDER BY ${ordering} LIMIT {row_limit:UInt32} FORMAT JSON`;
}
