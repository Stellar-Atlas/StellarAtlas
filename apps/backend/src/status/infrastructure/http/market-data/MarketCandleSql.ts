import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';
import { quoteHubbleIdentifier } from '../HubbleSemanticWarehouse.js';

/** Ledger primary-key pruning precedes pair filtering. No table-wide FINAL or MV. */
export function marketCandleSql(database: string): string {
	const db = quoteHubbleIdentifier(database);
	return `WITH logical AS (
 SELECT _ledger_sequence, history_operation_id, \`order\`,
  argMax(tuple(ledger_closed_at, selling_amount, buying_amount,
    if(selling_asset_type='native','native',concat(selling_asset_code,':',selling_asset_issuer))),
    tuple(_ingested_at, _batch_id, _row_number)) AS trade
 FROM ${db}.history_trades
 PREWHERE _ledger_sequence BETWEEN {minLedger:UInt32} AND {maxLedger:UInt32}
 WHERE ${completedHubbleBatchPredicate(database)}
  AND ((if(selling_asset_type='native','native',concat(selling_asset_code,':',selling_asset_issuer))={base:String}
    AND if(buying_asset_type='native','native',concat(buying_asset_code,':',buying_asset_issuer))={quote:String})
   OR (if(selling_asset_type='native','native',concat(selling_asset_code,':',selling_asset_issuer))={quote:String}
    AND if(buying_asset_type='native','native',concat(buying_asset_code,':',buying_asset_issuer))={base:String}))
 GROUP BY _ledger_sequence, history_operation_id, \`order\`
), normalized AS (
 SELECT _ledger_sequence, history_operation_id, \`order\`, tupleElement(trade,1) AS closed_at,
  if(tupleElement(trade,4)={base:String},tupleElement(trade,2),tupleElement(trade,3)) AS base_amount,
  if(tupleElement(trade,4)={base:String},tupleElement(trade,3),tupleElement(trade,2)) AS quote_amount
 FROM logical
 WHERE toUnixTimestamp(tupleElement(trade,1)) >= {from:UInt32}
  AND toUnixTimestamp(tupleElement(trade,1)) < {to:UInt32}
), priced AS (
 SELECT *, quote_amount / base_amount AS price,
  tuple(_ledger_sequence,history_operation_id,\`order\`) AS execution_order
 FROM normalized WHERE base_amount>0 AND quote_amount>0
  AND isFinite(base_amount) AND isFinite(quote_amount)
)
SELECT intDiv(toUnixTimestamp(closed_at),{resolution:UInt32})*{resolution:UInt32} AS timestamp,
 toString(argMin(price,execution_order)) AS open,
 toString(max(price)) AS high, toString(min(price)) AS low,
 toString(argMax(price,execution_order)) AS close,
 toString(sumKahan(base_amount)) AS baseVolume,
 toString(sumKahan(quote_amount)) AS quoteVolume,
 count() AS tradeCount,
 min(toUnixTimestamp(closed_at)) AS firstTradeAt,
 max(toUnixTimestamp(closed_at)) AS lastTradeAt
FROM priced WHERE isFinite(price)
GROUP BY timestamp ORDER BY timestamp ASC
LIMIT {limit:UInt32}
FORMAT JSON`;
}

export function marketSourceWindowSql(database: string): string {
	return `SELECT
 nullIf(min(toUnixTimestamp(closed_at)),0) AS first_time,
 nullIf(max(toUnixTimestamp(closed_at)),0) AS last_time,
 min(sequence) AS first_ledger, max(sequence) AS last_ledger,
 minIf(sequence,toUnixTimestamp(closed_at)>={from:UInt32}) AS from_ledger,
 maxIf(sequence,toUnixTimestamp(closed_at)<{to:UInt32}) AS to_ledger
 FROM ${quoteHubbleIdentifier(database)}.history_ledgers
 PREWHERE _ledger_sequence BETWEEN {minLedger:UInt32} AND {maxLedger:UInt32}
 WHERE ${completedHubbleBatchPredicate(database)}
 FORMAT JSON`;
}

/** Metadata-only primary-index estimate; compatible with the API's readonly=1 profile. */
export function marketReadEstimateSql(
	database: string,
	table: 'history_ledgers' | 'history_trades'
): string {
	return `EXPLAIN ESTIMATE SELECT _ledger_sequence FROM ${quoteHubbleIdentifier(database)}.${table}
 WHERE _ledger_sequence BETWEEN {minLedger:UInt32} AND {maxLedger:UInt32} FORMAT JSON`;
}
