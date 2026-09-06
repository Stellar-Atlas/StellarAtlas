import { queryHubbleContractEvents } from '../HubbleContractEventQuery.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;
engineTest('typed contract-event SELECT-only ClickHouse fixtures', () => {
	it('honors type/success/time filters, completed digests and exact tie-broken cursors', async () => {
		const contractId =
			'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA';
		const digest = 'a'.repeat(64),
			hash = 'b'.repeat(64),
			transactionId = '272689036992143360';
		const batch = (n: number) =>
			'00000000-0000-0000-0000-' + String(n).padStart(12, '0');
		const row = (n: number, position: number, type = 2, success = 0) =>
			"('" +
			batch(n) +
			"','" +
			digest +
			"',63490364," +
			position +
			",63490364,'2026-07-15 16:43:50','" +
			hash +
			"'," +
			transactionId +
			",NULL,'" +
			contractId +
			"'," +
			type +
			",'diagnostic'," +
			success +
			",0,'[]','{\"i128\":\"9007199254740993\"}','AAAA')";
		const ctes =
			"WITH batch_fixture AS (SELECT * FROM values('batch_id UUID, source_sha256 String, status String, updated_at UInt64',('" +
			batch(1) +
			"','" +
			digest +
			"','complete',1),('" +
			batch(2) +
			"','" +
			digest +
			"','complete',1),('" +
			batch(3) +
			"','" +
			digest +
			"','started',1))), event_fixture AS (SELECT * FROM values('_batch_id UUID, _source_sha256 String, _ledger_sequence UInt32, _row_number UInt64, ledger_sequence UInt32, closed_at DateTime64(3, \\'UTC\\'), transaction_hash String, transaction_id Int64, operation_id Nullable(Int64), contract_id String, type Int32, type_string String, successful Bool, in_successful_contract_call Bool, topics_decoded String, data_decoded String, contract_event_xdr String'," +
			[
				row(1, 10),
				row(2, 10),
				row(1, 9),
				row(3, 11),
				row(1, 12, 1),
				row(1, 13, 2, 1)
			].join(',') +
			')) ';
		const executor: HubbleSemanticQueryExecutor = {
			database: 'fixture',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				if (sql.includes("SELECT 'transaction' AS kind"))
					return {
						data: [
							{
								kind: 'transaction',
								transaction_id: transactionId,
								ledger_sequence: 63490364,
								operation_count: 1,
								operations: []
							},
							{
								kind: 'operations',
								transaction_id: transactionId,
								ledger_sequence: 63490364,
								operation_count: null,
								operations: [['272689036992143361', 24]]
							}
						] as unknown as T[]
					};
				const url = new URL(endpoint!);
				url.searchParams.set(
					'query',
					ctes +
						sql
							.replaceAll('`fixture`._ingestion_batches', 'batch_fixture')
							.replaceAll('`fixture`.history_contract_events', 'event_fixture')
				);
				for (const p of parameters)
					url.searchParams.set('param_' + p.name, p.value);
				const headers: Record<string, string> = {};
				if (process.env.HUBBLE_TEST_CLICKHOUSE_USER)
					headers.Authorization =
						'Basic ' +
						Buffer.from(
							process.env.HUBBLE_TEST_CLICKHOUSE_USER +
								':' +
								(process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
						).toString('base64');
				const response = await fetch(url, {
					method: 'POST',
					headers,
					signal: AbortSignal.timeout(15000)
				});
				const body = await response.text();
				if (!response.ok) throw new Error(body);
				return JSON.parse(body) as { data?: readonly T[] };
			}
		};
		const coverage = summarizeHubbleLedgerCoverage([
			{ start_ledger: 63490364, end_ledger: 63490364 }
		]);
		const input = {
			contractId,
			transactionHash: hash,
			minLedger: 63490364,
			maxLedger: 63490364,
			startTime: '2026-07-15T16:43:50Z',
			endTime: '2026-07-15T16:43:51Z',
			typeCode: 2,
			successful: false,
			inSuccessfulContractCall: false,
			limit: 1
		};
		const first = await queryHubbleContractEvents(executor, input, coverage);
		const second = await queryHubbleContractEvents(
			executor,
			{ ...input, after: first.nextCursor! },
			coverage
		);
		const third = await queryHubbleContractEvents(
			executor,
			{ ...input, after: second.nextCursor! },
			coverage
		);
		expect(first.items[0]!.id).toContain(':10:' + batch(2) + ':');
		expect(second.items[0]!.id).toContain(':10:' + batch(1) + ':');
		expect(third.items[0]!.id).toContain(':9:' + batch(1) + ':');
		expect(
			new Set([first, second, third].map((p) => p.items[0]!.id)).size
		).toBe(3);
		expect(third.nextCursor).toBeNull();
		expect(first.items[0]).toMatchObject({
			transactionId,
			successful: false,
			inSuccessfulContractCall: false,
			dataJson: '{"i128":"9007199254740993"}',
			classification: {
				transactionKind: 'soroban',
				eventKind: 'diagnostic',
				sorobanExecutionEvidence: true,
				provenance: 'complete'
			}
		});
		const empty = await queryHubbleContractEvents(
			executor,
			{
				...input,
				startTime: '2026-07-15T16:43:51Z',
				endTime: '2026-07-15T16:43:52Z'
			},
			coverage
		);
		expect(empty.items).toEqual([]);
	}, 45000);
});
