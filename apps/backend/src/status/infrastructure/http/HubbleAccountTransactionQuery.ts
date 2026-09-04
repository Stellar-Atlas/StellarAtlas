import {
	boundedSemanticLimit,
	boundedSemanticOffset,
	quoteHubbleIdentifier,
	type HubbleAccountTransactionQuery,
	type HubblePreparedParameter,
	type HubbleSemanticPage,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export async function queryHubbleAccountTransactions(
	executor: HubbleSemanticQueryExecutor,
	input: HubbleAccountTransactionQuery
): Promise<HubbleSemanticPage> {
	const limit = boundedSemanticLimit(input.limit, executor.maximumRows);
	const offset = boundedSemanticOffset(input.offset);
	const rowLimit = limit + 1;
	const database = quoteHubbleIdentifier(executor.database);
	const parameters: readonly HubblePreparedParameter[] = [
		{ name: 'account', type: 'String', value: input.account },
		{ name: 'row_limit', type: 'UInt32', value: String(rowLimit) },
		{ name: 'offset', type: 'UInt64', value: String(offset) }
	];
	const sql = `
SELECT
	transaction_hash,
	ledger_sequence,
	account,
	account_muxed,
	account_sequence,
	operation_count,
	successful,
	transaction_result_code,
	memo_type,
	memo,
	closed_at,
	toString(id) AS transaction_id,
	if(account = {account:String}, 'source', 'effect') AS relationship
FROM ${database}.history_transactions
WHERE account = {account:String}
	OR id IN (
		SELECT transaction_id
		FROM ${database}.history_operations
		WHERE id IN (
			SELECT operation_id
			FROM ${database}.history_effects
			WHERE address = {account:String}
		)
	)
ORDER BY ledger_sequence DESC, id DESC
LIMIT {row_limit:UInt32} OFFSET {offset:UInt64}
FORMAT JSON`;
	const startedAt = performance.now();
	const response = await executor.execute<Record<string, unknown>>(
		sql,
		parameters
	);
	const rows = [...(response.data ?? [])];
	const hasMore = rows.length > limit;
	return {
		elapsedMilliseconds:
			Math.round((performance.now() - startedAt) * 100) / 100,
		limit,
		nextOffset: hasMore ? offset + limit : null,
		offset,
		rows: hasMore ? rows.slice(0, limit) : rows
	};
}
