import { queryHubbleTransferActivity } from '../HubbleTransferQuery.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
import {
	exactTransferAmount,
	transferAccount
} from './HubbleTransferFixture.js';

// Inline VALUES and small synthetic CTEs only: never reads or writes live fact tables.
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;
engineTest('exact transfer activity on ClickHouse', () => {
	it('retains >2^53 amounts and pages numeric row ties while hiding unpublished rows', async () => {
		const digest = 'a'.repeat(64);
		const batch = (n: number) =>
			'00000000-0000-0000-0000-' + String(n).padStart(12, '0');
		const row = (n: number, position: number, amount: string) =>
			"('" +
			batch(n) +
			"', '" +
			digest +
			"', 63, " +
			position +
			", 63, '2026-09-01 00:00:00', '" +
			digest +
			"', 9007199254740993, NULL, '" +
			transferAccount +
			"', NULL, NULL, 'native', 'native', NULL, NULL, 'C" +
			'A'.repeat(55) +
			"', 'transfer', '" +
			amount +
			"')";
		const ctes =
			'WITH batch_fixture AS (SELECT * FROM values(' +
			"'batch_id UUID, source_sha256 String, status String, updated_at UInt64'," +
			"('" +
			batch(1) +
			"', '" +
			digest +
			"', 'complete', 1)," +
			"('" +
			batch(2) +
			"', '" +
			digest +
			"', 'complete', 1)," +
			"('" +
			batch(3) +
			"', '" +
			digest +
			"', 'failed', 1))), " +
			'transfer_fixture AS (SELECT * FROM values(' +
			"'_batch_id UUID, _source_sha256 String, _ledger_sequence UInt32, _row_number UInt64, " +
			'ledger_sequence UInt32, closed_at DateTime64(3), transaction_hash String, transaction_id Int64, ' +
			'operation_id Nullable(Int64), from Nullable(String), to Nullable(String), to_muxed Nullable(String), ' +
			'asset String, asset_type String, asset_code Nullable(String), asset_issuer Nullable(String), ' +
			"contract_id String, event_topic String, amount_raw String'," +
			[
				row(1, 10, exactTransferAmount),
				row(2, 10, exactTransferAmount),
				row(1, 9, exactTransferAmount),
				row(3, 11, exactTransferAmount),
				row(1, 12, '9007199254740993123456790'),
				row(1, 8, '-1')
			].join(',') +
			')) ';
		const executor: HubbleSemanticQueryExecutor = {
			database: 'fixture',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				const url = new URL(endpoint!);
				url.searchParams.set(
					'query',
					ctes +
						sql
							.replaceAll('`fixture`._ingestion_batches', 'batch_fixture')
							.replaceAll('`fixture`.token_transfers', 'transfer_fixture')
				);
				for (const parameter of parameters)
					url.searchParams.set('param_' + parameter.name, parameter.value);
				const headers: Record<string, string> = {};
				const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
				if (user)
					headers.Authorization =
						'Basic ' +
						Buffer.from(
							user + ':' + (process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
						).toString('base64');
				const response = await fetch(url, {
					method: 'POST',
					headers,
					signal: AbortSignal.timeout(15_000)
				});
				const body = await response.text();
				if (!response.ok) throw new Error('Inline fixture failed: ' + body);
				return JSON.parse(body) as { data?: readonly T[] };
			}
		};
		const input = {
			minLedger: 63,
			maxLedger: 63,
			amountRaw: exactTransferAmount,
			limit: 1
		};
		const first = await queryHubbleTransferActivity(executor, input, 63);
		const second = await queryHubbleTransferActivity(
			executor,
			{ ...input, after: first.nextCursor! },
			63
		);
		const third = await queryHubbleTransferActivity(
			executor,
			{ ...input, after: second.nextCursor! },
			63
		);
		expect(first.transfers[0]!.id).toContain(':10:' + batch(2) + ':');
		expect(second.transfers[0]!.id).toContain(':10:' + batch(1) + ':');
		expect(third.transfers[0]!.id).toContain(':9:' + batch(1) + ':');
		expect(first.transfers[0]!.amountRaw).toBe(exactTransferAmount);
		expect(first.transfers[0]!.transactionId).toBe('9007199254740993');
		expect(first.transfers[0]!.closedAt).toBe('2026-09-01T00:00:00.000Z');
		expect(third.nextCursor).toBeNull();
		const signed = await queryHubbleTransferActivity(
			executor,
			{ minLedger: 63, maxLedger: 63, limit: 10 },
			63
		);
		expect(signed.transfers.some((row) => row.amountRaw === '-1')).toBe(true);
	}, 45_000);
});
