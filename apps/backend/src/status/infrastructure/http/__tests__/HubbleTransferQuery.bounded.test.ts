import { queryHubbleTransferActivity } from '../HubbleTransferQuery.js';
import { queryHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

// Explicit opt-in only: fixed 100-ledger historical range, <=10 returned rows.
// No broad table scan or data/service mutation; emits query statistics, not account data.
const enabled = process.env.HUBBLE_TEST_LIVE_TRANSFER === '1';
const boundedTest = enabled ? describe : describe.skip;
boundedTest('transfer activity bounded production evidence', () => {
	it('executes the 26000000-26000099 demo and checks partition pruning', async () => {
		const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
		if (!endpoint)
			throw new Error('A read-only ClickHouse endpoint is required');
		const headers: Record<string, string> = {};
		const user = process.env.HUBBLE_TEST_CLICKHOUSE_USER;
		if (user)
			headers.Authorization =
				'Basic ' +
				Buffer.from(
					user + ':' + (process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD ?? '')
				).toString('base64');
		let statement = '';
		let boundParameters: readonly HubblePreparedParameter[] = [];
		let statistics: unknown;
		async function read(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		): Promise<{
			data?: readonly Record<string, unknown>[];
			statistics?: unknown;
		}> {
			const url = new URL(endpoint!);
			url.searchParams.set('query', sql);
			for (const parameter of parameters)
				url.searchParams.set('param_' + parameter.name, parameter.value);
			const response = await fetch(url, {
				method: 'POST',
				headers,
				signal: AbortSignal.timeout(30_000)
			});
			const body = await response.text();
			if (!response.ok)
				throw new Error(
					'Bounded transfer check failed: HTTP ' +
						response.status +
						' ' +
						body.slice(-1500)
				);
			return JSON.parse(body) as {
				data?: readonly Record<string, unknown>[];
				statistics?: unknown;
			};
		}
		const executor: HubbleSemanticQueryExecutor = {
			database: process.env.HUBBLE_TEST_CLICKHOUSE_DATABASE ?? 'stellar_hubble',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				statement = sql;
				boundParameters = parameters;
				const result = await read(sql, parameters);
				statistics = result.statistics;
				return result as { data?: readonly T[] };
			}
		};
		const coverage = await queryHubbleLedgerCoverage(executor);
		const page = await queryHubbleTransferActivity(
			executor,
			{
				asset: 'native',
				eventTopic: 'transfer',
				minLedger: 26_000_000,
				maxLedger: 26_000_099,
				limit: 10
			},
			Number(coverage.maximumLedger)
		);
		const plan = await read(
			'EXPLAIN indexes = 1 ' + statement,
			boundParameters
		);
		expect(page.transfers.length).toBeLessThanOrEqual(10);
		const planText = (plan.data ?? [])
			.map((row) => String(row.explain))
			.join('\n');
		expect(planText).toContain('Partition');
		expect(planText).toContain('_ledger_sequence');
		console.info(
			'bounded_transfer_evidence',
			JSON.stringify({
				returnedRows: page.transfers.length,
				hasNextCursor: page.nextCursor !== null,
				watermark: page.watermark,
				elapsedMilliseconds: page.elapsedMilliseconds,
				statistics,
				plan: planText
			})
		);
	}, 60_000);
});
