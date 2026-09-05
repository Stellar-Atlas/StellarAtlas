import { completedHubbleBatchPredicate } from './HubbleBatchVisibility.js';
// Execution limits are owned by the existing read-only ClickHouse profile.
import { maximumHubbleTransactionOperations } from './HubbleEventClassification.js';
import {
	classifyHubbleEvent,
	hubbleEventIdentifier,
	hubbleEventLedger,
	type HubbleEventClassification,
	type HubbleEventOperation,
	type HubbleEventProvenance
} from './HubbleEventClassification.js';
import {
	quoteHubbleIdentifier,
	type HubblePreparedParameter,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

interface RelationshipRow {
	readonly kind: unknown;
	readonly transaction_id: unknown;
	readonly ledger_sequence: unknown;
	readonly operation_count: unknown;
	readonly operations: unknown;
}

export async function classifyHubbleEventRows(
	executor: HubbleSemanticQueryExecutor,
	rows: readonly Record<string, unknown>[]
): Promise<
	readonly (Record<string, unknown> & {
		readonly classification: HubbleEventClassification;
	})[]
> {
	if (rows.length > executor.maximumRows)
		throw new RangeError('Event page exceeds configured maximum rows');
	const keys = new Map<
		string,
		{ transactionId: string; ledgerSequence: number }
	>();
	for (const row of rows) {
		const transactionId = hubbleEventIdentifier(row.transaction_id);
		const ledgerSequence = hubbleEventLedger(row.ledger_sequence);
		if (transactionId !== null && ledgerSequence !== null)
			keys.set(ledgerSequence + ':' + transactionId, {
				transactionId,
				ledgerSequence
			});
	}
	if (keys.size === 0)
		return rows.map((row) => ({
			...row,
			classification: classifyHubbleEvent(row, null)
		}));
	const parameters: HubblePreparedParameter[] = [];
	const targets = [...keys.values()]
		.map((key, index) => {
			parameters.push(
				{
					name: 'ledger' + index,
					type: 'UInt32',
					value: String(key.ledgerSequence)
				},
				{ name: 'transaction' + index, type: 'Int64', value: key.transactionId }
			);
			return '({ledger' + index + ':UInt32},{transaction' + index + ':Int64})';
		})
		.join(',');
	const ledgers = [...keys.values()]
		.map((_, index) => '{ledger' + index + ':UInt32}')
		.join(',');
	const database = quoteHubbleIdentifier(executor.database);
	const published = completedHubbleBatchPredicate(executor.database);
	// Both branches are restricted to identities from this returned page. Explicit
	// ledger predicates retain partition/index pruning; no whole-history join.
	const sql = `
SELECT * FROM (
SELECT 'transaction' AS kind, toString(id) AS transaction_id, ledger_sequence,
 toNullable(operation_count) AS operation_count, [] AS operations
FROM ${database}.history_transactions
WHERE _ledger_sequence IN (${ledgers}) AND ledger_sequence IN (${ledgers})
 AND (ledger_sequence,id) IN (${targets}) AND ${published}
UNION ALL
SELECT 'operations' AS kind, toString(o.transaction_id) AS transaction_id, o.ledger_sequence AS ledger_sequence,
 NULL AS operation_count, groupUniqArray(${maximumHubbleTransactionOperations + 1})((toString(o.id),o.type)) AS operations
FROM ${database}.history_operations o
WHERE o._ledger_sequence IN (${ledgers}) AND o.ledger_sequence IN (${ledgers})
 AND (o.ledger_sequence,o.transaction_id) IN (${targets}) AND ${published}
GROUP BY o.ledger_sequence,o.transaction_id
)
LIMIT ${keys.size * 2 + 1}
FORMAT JSON`;
	const response = await executor.execute<RelationshipRow>(sql, parameters);
	// The extra row is a completeness sentinel, not silently truncated provenance.
	if ((response.data?.length ?? 0) > keys.size * 2)
		return rows.map((row) => ({
			...row,
			classification: {
				...classifyHubbleEvent(row, null),
				provenance: 'incomplete'
			}
		}));
	const contexts = new Map<string, HubbleEventProvenance>();
	const counts = new Map<string, Set<number>>();
	const operations = new Map<string, readonly HubbleEventOperation[]>();
	for (const row of response.data ?? []) {
		const transactionId = hubbleEventIdentifier(row.transaction_id);
		const ledgerSequence = hubbleEventLedger(row.ledger_sequence);
		const key = ledgerSequence + ':' + transactionId;
		if (transactionId === null || ledgerSequence === null || !keys.has(key))
			continue;
		if (row.kind === 'transaction') {
			const count =
				typeof row.operation_count === 'number' ? row.operation_count : NaN;
			const found = counts.get(key) ?? new Set<number>();
			found.add(count);
			counts.set(key, found);
		} else if (row.kind === 'operations' && Array.isArray(row.operations)) {
			const parsed: HubbleEventOperation[] = [];
			for (const value of row.operations) {
				if (!Array.isArray(value)) continue;
				const id = hubbleEventIdentifier(value[0]);
				const type: unknown = value[1];
				if (id !== null && typeof type === 'number') parsed.push({ id, type });
			}
			operations.set(key, parsed);
		}
	}
	for (const [key, identity] of keys) {
		const count = counts.get(key);
		if (count?.size !== 1) continue;
		contexts.set(key, {
			...identity,
			expectedOperationCount: [...count][0]!,
			operations: operations.get(key) ?? []
		});
	}
	return rows.map((row) => {
		const key =
			hubbleEventLedger(row.ledger_sequence) +
			':' +
			hubbleEventIdentifier(row.transaction_id);
		return {
			...row,
			classification: classifyHubbleEvent(row, contexts.get(key) ?? null)
		};
	});
}
