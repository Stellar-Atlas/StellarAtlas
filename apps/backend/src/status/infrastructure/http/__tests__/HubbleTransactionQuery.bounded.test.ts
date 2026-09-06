import { queryHubbleTransactionDetail } from '../HubbleTransactionQuery.js';
import type {
	HubbleSemanticQueryExecutor,
	HubblePreparedParameter
} from '../HubbleSemanticWarehouse.js';
const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const liveTest =
	endpoint && process.env.HUBBLE_TEST_LIVE_TRANSACTION === '1'
		? describe
		: describe.skip;
// Explicit opt-in, exact known ledger/hash only. Never execute an unhinted live lookup.
liveTest('bounded published transaction live gate', () => {
	it('returns parsed exact transaction relationships with native-key pruning', async () => {
		const database = process.env.HUBBLE_TEST_CLICKHOUSE_DATABASE!;
		const statistics: unknown[] = [];
		let explained = false;
		const executor: HubbleSemanticQueryExecutor = {
			database,
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				if (
					!parameters.some(
						(p) =>
							(p.name === 'ledger' || p.name === 'ledger0') &&
							p.value === '26000000'
					)
				)
					throw new Error(
						'Live transaction gate requires the exact approved ledger'
					);
				async function request(
					query: string
				): Promise<{ data?: readonly T[]; statistics?: unknown }> {
					const url = new URL(endpoint!);
					url.searchParams.set('query', query);
					for (const p of parameters)
						url.searchParams.set('param_' + p.name, p.value);
					const response = await fetch(url, {
						method: 'POST',
						headers: {
							Authorization:
								'Basic ' +
								Buffer.from(
									process.env.HUBBLE_TEST_CLICKHOUSE_USER +
										':' +
										process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD
								).toString('base64')
						},
						signal: AbortSignal.timeout(30000)
					});
					const body = await response.text();
					if (!response.ok)
						throw new Error(
							'Bounded live transaction query failed: ' + body.slice(0, 512)
						);
					return JSON.parse(body) as {
						data?: readonly T[];
						statistics?: unknown;
					};
				}
				if (!explained) {
					explained = true;
					const plan = await request('EXPLAIN indexes=1 ' + sql);
					console.info(
						'Transaction native pruning plan',
						JSON.stringify(plan.data)
					);
				}
				const result = await request(sql);
				statistics.push({
					query: sql.includes("SELECT 'transaction' AS kind")
						? 'classification'
						: sql.match(/FROM [^\n]+/)?.[0],
					statistics: result.statistics
				});
				return result;
			}
		};
		const detail = await queryHubbleTransactionDetail(executor, {
			transactionHash:
				'5601a324dae6b95aeb626e4de68268fbb996a655979228178d291fc4b8c908cd',
			ledgerSequence: 26000000,
			limit: 5
		});
		expect(detail!.transaction.id).toBe('111669149696004096');
		expect(detail!.transaction.operationCount).toBe(19);
		expect(detail!.operations.items).toHaveLength(5);
		expect(detail!.operations.nextCursor).not.toBeNull();
		expect(detail!.operations.items.every((item) => item.envelopeDecoded)).toBe(
			true
		);
		expect(
			detail!.events.items.some(
				(item) =>
					item.classification.eventKind === 'fee' &&
					item.classification.transactionKind === 'classic'
			)
		).toBe(true);
		expect(detail!.effects.items.length).toBeGreaterThan(0);
		console.info(
			'Bounded transaction read statistics',
			JSON.stringify(statistics)
		);
	}, 60000);
});
