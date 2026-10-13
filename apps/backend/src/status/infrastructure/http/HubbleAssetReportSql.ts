import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter
} from './HubbleSemanticWarehouse.js';
import type {
	Cursor,
	RankingSelection,
	ReportAsset,
	ReportSelection
} from './HubbleAssetReportQuery.js';

function paramsAsset(
	prefix: string,
	asset: ReportAsset
): HubblePreparedParameter[] {
	return asset.type === 'native'
		? []
		: [
				{ name: prefix + '_code', type: 'String', value: asset.code },
				{ name: prefix + '_issuer', type: 'String', value: asset.issuer }
			];
}

function paramsWindow(
	input: ReportSelection,
	min: number,
	max: number
): HubblePreparedParameter[] {
	const p: HubblePreparedParameter[] = [
		{ name: 'min_ledger', type: 'UInt32', value: String(min) },
		{ name: 'max_ledger', type: 'UInt32', value: String(max) }
	];
	if (input.startTime)
		p.push({
			name: 'start_time',
			type: 'DateTime64(3)',
			value: input.startTime
		});
	if (input.endTime)
		p.push({ name: 'end_time', type: 'DateTime64(3)', value: input.endTime });
	return p;
}

function perspectiveMatch(offset: 2 | 5, asset: ReportAsset): string {
	const t = `tupleElement(perspective,${offset})`,
		code = `tupleElement(perspective,${offset + 1})`,
		issuer = `tupleElement(perspective,${offset + 2})`;
	const prefix = offset === 2 ? 'target' : 'counter';
	return asset.type === 'native'
		? `${t}='native'`
		: `${t} IN ('credit_alphanum4','credit_alphanum12') AND ${code}={${prefix}_code:String} AND ${issuer}={${prefix}_issuer:String}`;
}

function rawAssetMatch(side: 'selling' | 'buying', asset: ReportAsset): string {
	return asset.type === 'native'
		? `${side}_asset_type='native'`
		: `${side}_asset_type IN ('credit_alphanum4','credit_alphanum12') AND ${side}_asset_code={target_code:String} AND ${side}_asset_issuer={target_issuer:String}`;
}

export function tradePerspectiveTuples(): readonly string[] {
	return [
		"tuple(tupleElement(t,1),tupleElement(t,3),tupleElement(t,4),tupleElement(t,5),tupleElement(t,6),tupleElement(t,7),tupleElement(t,8),'sell',tupleElement(t,9),tupleElement(t,10))",
		"tuple(tupleElement(t,2),tupleElement(t,3),tupleElement(t,4),tupleElement(t,5),tupleElement(t,6),tupleElement(t,7),tupleElement(t,8),'buy',tupleElement(t,9),tupleElement(t,10))",
		"tuple(tupleElement(t,1),tupleElement(t,6),tupleElement(t,7),tupleElement(t,8),tupleElement(t,3),tupleElement(t,4),tupleElement(t,5),'buy',tupleElement(t,10),tupleElement(t,9))",
		"tuple(tupleElement(t,2),tupleElement(t,6),tupleElement(t,7),tupleElement(t,8),tupleElement(t,3),tupleElement(t,4),tupleElement(t,5),'sell',tupleElement(t,10),tupleElement(t,9))"
	];
}

export function buildAssetRankSql(
	db: string,
	input: RankingSelection,
	cursor?: Cursor
): { sql: string; parameters: HubblePreparedParameter[] } {
	const parameters = [
		...paramsWindow(
			input,
			cursor?.min ?? input.minLedger ?? 2,
			cursor?.max ?? input.maxLedger ?? 4294967295
		),
		...paramsAsset('target', input.asset)
	];
	if (input.counterAsset)
		parameters.push(...paramsAsset('counter', input.counterAsset));
	if (input.account)
		parameters.push({ name: 'account', type: 'String', value: input.account });
	parameters.push({
		name: 'row_limit',
		type: 'UInt32',
		value: String(input.limit + 1)
	});
	if (cursor?.score !== undefined)
		parameters.push({
			name: 'after_score',
			type: 'Float64',
			value: String(cursor.score)
		});
	if (cursor?.account)
		parameters.push({
			name: 'after_account',
			type: 'String',
			value: cursor.account
		});
	const tuples = tradePerspectiveTuples().join(',');
	const target = perspectiveMatch(2, input.asset);
	const counter = input.counterAsset
		? ` AND (${perspectiveMatch(5, input.counterAsset)})`
		: '';
	const direction =
		input.metric === 'bought'
			? " AND tupleElement(perspective,8) = 'buy'"
			: input.metric === 'sold'
				? " AND tupleElement(perspective,8) = 'sell'"
				: '';
	const metric =
		input.metric === 'transactions'
			? 'toUInt64(transaction_count)'
			: 'asset_volume';
	const order = input.order.toUpperCase();
	const cursorSql =
		cursor?.score === undefined
			? ''
			: `WHERE (${metric} ${input.order === 'asc' ? '>' : '<'} {after_score:Float64} OR (${metric} = {after_score:Float64} AND account_id > {after_account:String}))`;
	const sql = `
WITH published AS (
 SELECT history_operation_id, \`order\`,
  argMax(tuple(selling_account_address,buying_account_address,selling_asset_type,selling_asset_code,selling_asset_issuer,buying_asset_type,buying_asset_code,buying_asset_issuer,selling_amount,buying_amount,_ledger_sequence,_row_number,_ingested_at,_batch_id,_source_sha256),
   tuple(_ingested_at,_row_number,toString(_batch_id),toString(_source_sha256))) AS t
 FROM ${quoteHubbleIdentifier(db)}.history_trades
 WHERE ${completedHubbleBatchPredicate(db)} AND _ledger_sequence BETWEEN {min_ledger:UInt32} AND {max_ledger:UInt32}${input.startTime ? ' AND ledger_closed_at >= {start_time:DateTime64(3)}' : ''}${input.endTime ? ' AND ledger_closed_at <= {end_time:DateTime64(3)}' : ''}
 AND ((${rawAssetMatch('selling', input.asset)}) OR (${rawAssetMatch('buying', input.asset)}))
 GROUP BY _ledger_sequence,history_operation_id,\`order\`
),
expanded AS (
 SELECT tupleElement(t,11) AS ledger, history_operation_id, tupleElement(t,1) AS seller, tupleElement(t,2) AS buyer,
  tupleElement(t,3) AS selling_asset_type,tupleElement(t,4) AS selling_asset_code,tupleElement(t,5) AS selling_asset_issuer,
  tupleElement(t,6) AS buying_asset_type,tupleElement(t,7) AS buying_asset_code,tupleElement(t,8) AS buying_asset_issuer,
  tupleElement(t,9) AS selling_amount,tupleElement(t,10) AS buying_amount,
  arrayJoin([${tuples}]) AS perspective
 FROM published
),
normalized AS (
 SELECT tupleElement(perspective,1) AS account_id, tupleElement(perspective,2) AS asset_type,
  tupleElement(perspective,3) AS asset_code, tupleElement(perspective,4) AS asset_issuer,
  tupleElement(perspective,5) AS counter_type, tupleElement(perspective,6) AS counter_code, tupleElement(perspective,7) AS counter_issuer,
  tupleElement(perspective,8) AS direction, tupleElement(perspective,9) AS asset_amount, tupleElement(perspective,10) AS counter_amount,
  ledger, history_operation_id, bitShiftRight(toUInt64(history_operation_id),12) AS transaction_id
 FROM expanded
 WHERE account_id != '' AND (${target})${counter}${direction}${input.account ? ' AND tupleElement(perspective,1) = {account:String}' : ''}
),
ranked AS (
 SELECT account_id, sum(asset_amount) AS asset_volume,
  ${input.counterAsset ? 'sum(counter_amount)' : "CAST(NULL,'Nullable(Float64)')"} AS counter_volume,
  toString(count()) AS trade_count, toString(uniqExact(history_operation_id)) AS operation_count,
  toString(uniqExact(transaction_id)) AS transaction_count, min(ledger) AS first_ledger,max(ledger) AS last_ledger
 FROM normalized GROUP BY account_id
)
SELECT *, ${metric} AS score FROM ranked ${cursorSql}
ORDER BY score ${order}, account_id ASC LIMIT {row_limit:UInt32}
FORMAT JSON`;
	return { sql, parameters };
}

export function buildAssetHistorySql(
	db: string,
	input: ReportSelection,
	cursor?: Cursor,
	account?: string
): { sql: string; parameters: HubblePreparedParameter[] } {
	const { min, max } = {
		min: cursor?.min ?? input.minLedger ?? 2,
		max: cursor?.max ?? input.maxLedger ?? 4294967295
	};
	const parameters = [
		...paramsWindow(input, min, max),
		{ name: 'row_limit', type: 'UInt32', value: String(input.limit + 1) }
	];
	if (cursor?.ledger !== undefined) {
		parameters.push({
			name: 'after_ledger',
			type: 'UInt32',
			value: String(cursor.ledger)
		});
		parameters.push({
			name: 'after_account',
			type: 'String',
			value: cursor.account ?? ''
		});
	}
	const table = input.asset.type === 'native' ? 'accounts' : 'trustlines';
	if (input.asset.type !== 'native')
		parameters.push(
			{ name: 'target_code', type: 'String', value: input.asset.code },
			{ name: 'target_issuer', type: 'String', value: input.asset.issuer }
		);
	const assetWhere =
		input.asset.type === 'native'
			? ''
			: 'AND asset_code = {target_code:String} AND asset_issuer = {target_issuer:String}';
	const cursorWhere =
		cursor?.ledger === undefined
			? ''
			: input.order === 'asc'
				? 'AND (ledger_sequence > {after_ledger:UInt32} OR (ledger_sequence = {after_ledger:UInt32} AND account_id > {after_account:String}))'
				: 'AND (ledger_sequence < {after_ledger:UInt32} OR (ledger_sequence = {after_ledger:UInt32} AND account_id > {after_account:String}))';
	const order = input.order.toUpperCase();
	const published = completedHubbleBatchPredicate(db);
	const sql = `
WITH states AS (
 SELECT ledger_sequence, account_id,
  argMax(tuple(balance,buying_liabilities,selling_liabilities,${input.asset.type === 'native' ? "CAST(NULL,'Nullable(Int64)')" : 'trust_line_limit'},flags,ifNull(sponsor,''),last_modified_ledger,deleted,_row_number,_ingested_at,_batch_id,_source_sha256,closed_at),
   tuple(_row_number,_ingested_at,toString(_batch_id),toString(_source_sha256))) AS state
 FROM ${quoteHubbleIdentifier(db)}.${table}
 WHERE ledger_sequence BETWEEN {min_ledger:UInt32} AND {max_ledger:UInt32} AND ${published} ${assetWhere} ${cursorWhere}
 ${account ? 'AND account_id = {account:String}' : ''}
 ${input.startTime ? 'AND closed_at >= {start_time:DateTime64(3)}' : ''}
 ${input.endTime ? 'AND closed_at <= {end_time:DateTime64(3)}' : ''}
 GROUP BY ledger_sequence,account_id
)
SELECT s.ledger_sequence AS ledger, s.account_id,
 tupleElement(s.state,1) AS balance,tupleElement(s.state,2) AS buying_liabilities,
 tupleElement(s.state,3) AS selling_liabilities,toString(tupleElement(s.state,4)) AS trust_line_limit,
 tupleElement(s.state,5) AS flags,tupleElement(s.state,6) AS sponsor,
 tupleElement(s.state,7) AS last_modified_ledger,tupleElement(s.state,8) AS deleted,
 tupleElement(s.state,9) AS source_row_number,tupleElement(s.state,10) AS source_ingested_at,
 tupleElement(s.state,11) AS source_batch_id,tupleElement(s.state,12) AS source_sha256,
 tupleElement(s.state,13) AS ledger_closed_at
FROM states s
ORDER BY ledger ${order}, account_id ASC LIMIT {row_limit:UInt32}
FORMAT JSON`;
	return { sql, parameters };
}
