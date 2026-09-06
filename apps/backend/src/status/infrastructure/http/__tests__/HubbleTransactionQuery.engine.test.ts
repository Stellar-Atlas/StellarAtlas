import { queryHubbleTransactionDetail } from '../HubbleTransactionQuery.js';
import type {
	HubbleSemanticQueryExecutor,
	HubblePreparedParameter
} from '../HubbleSemanticWarehouse.js';
import {
	transactionFixture,
	operationFixtures,
	effectFixtures,
	eventFixtures,
	transactionHash,
	transactionLedger,
	transactionBatch,
	transactionDigest
} from './HubbleTransactionFixture.js';

// Inline VALUES only. No live fact reads, CREATE, INSERT, or profile overrides.
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;
const common: readonly [string, string][] = [
	['_batch_id', 'UUID'],
	['_source_sha256', 'String'],
	['_ledger_sequence', 'UInt32'],
	['_row_number', 'UInt64'],
	['ledger_sequence', 'UInt32'],
	['closed_at', 'DateTime64(3)']
];
function literal(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value))
		return (
			'[' +
			value
				.map((v) => literal(typeof v === 'object' ? JSON.stringify(v) : v))
				.join(',') +
			']'
		);
	return (
		"'" + String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'") + "'"
	);
}
function table(
	name: string,
	columns: readonly (readonly [string, string])[],
	rows: readonly Record<string, unknown>[]
): string {
	return (
		name +
		' AS (SELECT * FROM values(' +
		literal(columns.map(([n, t]) => n + ' ' + t).join(', ')) +
		',' +
		rows
			.map(
				(row) =>
					'(' + columns.map(([name]) => literal(row[name])).join(',') + ')'
			)
			.join(',') +
		'))'
	);
}
const ctes =
	'WITH ' +
	[
		table(
			'batch_fixture',
			[
				['batch_id', 'UUID'],
				['source_sha256', 'String'],
				['status', 'String'],
				['updated_at', 'UInt64']
			],
			[
				{
					batch_id: transactionBatch,
					source_sha256: transactionDigest,
					status: 'complete',
					updated_at: 1
				}
			]
		),
		table(
			'transaction_fixture',
			[
				...common,
				['id', 'Int64'],
				['transaction_hash', 'String'],
				['account', 'String'],
				['account_muxed', 'String'],
				['account_sequence', 'Int64'],
				['successful', 'Bool'],
				['operation_count', 'Int32'],
				['memo_type', 'String'],
				['memo', 'String'],
				['fee_charged', 'Int64'],
				['max_fee', 'UInt32'],
				['fee_account', 'String'],
				['transaction_result_code', 'String'],
				['tx_envelope', 'String']
			],
			[transactionFixture]
		),
		table(
			'operation_fixture',
			[
				...common,
				['id', 'Int64'],
				['transaction_id', 'Int64'],
				['type', 'Int32'],
				['type_string', 'String'],
				['source_account', 'String'],
				['source_account_muxed', 'String'],
				['operation_result_code', 'String'],
				['operation_trace_code', 'String'],
				['details', 'String']
			],
			operationFixtures
		),
		table(
			'effect_fixture',
			[
				...common,
				['id', 'String'],
				['operation_id', 'Int64'],
				['index', 'UInt32'],
				['type', 'Int32'],
				['type_string', 'String'],
				['address', 'String'],
				['address_muxed', 'Nullable(String)'],
				['details', 'String']
			],
			effectFixtures
		),
		table(
			'event_fixture',
			[
				...common,
				['transaction_id', 'Int64'],
				['transaction_hash', 'String'],
				['operation_id', 'Nullable(Int64)'],
				['type', 'Int32'],
				['type_string', 'String'],
				['contract_id', 'String'],
				['successful', 'Bool'],
				['in_successful_contract_call', 'Bool'],
				['topics_decoded', 'Array(String)'],
				['data_decoded', 'String'],
				['contract_event_xdr', 'String']
			],
			eventFixtures
		)
	].join(',') +
	' ';
engineTest('transaction detail on ClickHouse inline fixtures', () => {
	it('executes exact identifiers/amounts, fee classification and independently scoped numeric keysets', async () => {
		const executor: HubbleSemanticQueryExecutor = {
			database: 'fixture',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				const url = new URL(endpoint!);
				const tables: Readonly<Record<string, string>> = {
					_ingestion_batches: 'batch_fixture',
					history_transactions: 'transaction_fixture',
					history_operations: 'operation_fixture',
					history_effects: 'effect_fixture',
					history_contract_events: 'event_fixture'
				};
				for (const [name, fixture] of Object.entries(tables))
					sql = sql.replaceAll('`fixture`.' + name, fixture);
				url.searchParams.set('query', ctes + sql);
				for (const p of parameters)
					url.searchParams.set('param_' + p.name, p.value);
				const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
				const response = await fetch(url, {
					method: 'POST',
					headers: user
						? {
								Authorization:
									'Basic ' +
									Buffer.from(
										user +
											':' +
											(process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
									).toString('base64')
							}
						: {},
					signal: AbortSignal.timeout(15000)
				});
				const body = await response.text();
				if (!response.ok)
					throw new Error('Inline transaction fixture failed: ' + body);
				return JSON.parse(body) as { data?: readonly T[] };
			}
		};
		const first = await queryHubbleTransactionDetail(executor, {
			transactionHash,
			ledgerSequence: transactionLedger,
			limit: 1
		});
		expect(first!.transaction.id).toBe(transactionFixture.id);
		expect(first!.operations.items[0]!.amounts[0]!.raw).toBe(
			'9007199254740993'
		);
		expect(first!.effects.items[0]!.amounts[0]!.raw).toBe('9007199254740993');
		expect(first!.events.items[0]!.classification.eventKind).toBe('fee');
		const second = await queryHubbleTransactionDetail(executor, {
			transactionHash,
			limit: 1,
			operationsAfter: first!.operations.nextCursor!,
			effectsAfter: first!.effects.nextCursor!,
			eventsAfter: first!.events.nextCursor!
		});
		expect(second!.operations.items[0]!.index).toBe(1);
		expect(second!.effects.items[0]!.index).toBe(1);
		expect(second!.events.items[0]!.operationId).toBe(operationFixtures[0]!.id);
		expect(second!.operations.nextCursor).toBeNull();
		expect(second!.effects.nextCursor).not.toBeNull();
	}, 45000);
});
