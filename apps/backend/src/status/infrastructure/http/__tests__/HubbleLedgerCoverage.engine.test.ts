import {
	isHubbleLedgerWindowComplete,
	queryHubbleLedgerCoverage
} from '../HubbleLedgerCoverage.js';
import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';

const endpoint = process.env.HUBBLE_TEST_CLICKHOUSE_URL;
const engineTest = endpoint ? describe : describe.skip;

// Explicit opt-in, SELECT-only inline rows; never reads or writes warehouse facts.
engineTest('completed-window coverage on ClickHouse', () => {
	it('keeps supplemental ranges but excludes later failures and unfinished retries', async () => {
		const executor: HubbleSemanticQueryExecutor = {
			database: 'fixture',
			maximumRows: 200,
			async execute<T>(sql: string) {
				const url = new URL(endpoint!);
				url.searchParams.set(
					'query',
					`WITH batch_fixture AS (
 SELECT * FROM values(
 'batch_id UInt64, status String, start_ledger UInt32, end_ledger UInt32, updated_at UInt64',
 (1,'complete',2,10,1),
 (2,'complete',100,109,1), (3,'complete',110,119,1),
 (4,'complete',120,129,1), (4,'failed',120,129,2),
 (5,'complete',130,139,1), (5,'started',130,139,2),
 (6,'failed',140,149,1), (6,'started',140,149,2), (6,'complete',140,149,3),
 (7,'started',150,159,1), (8,'complete',105,114,1)
 )
) ` + sql.replace('`fixture`._ingestion_batches', 'batch_fixture')
				);
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
					signal: AbortSignal.timeout(10000)
				});
				expect(response.status).toBe(200);
				return (await response.json()) as { data?: readonly T[] };
			}
		};
		const coverage = await queryHubbleLedgerCoverage(executor);
		expect(coverage.completedRanges).toEqual([
			{ firstLedger: '2', lastLedger: '10' },
			{ firstLedger: '100', lastLedger: '119' },
			{ firstLedger: '140', lastLedger: '149' }
		]);
		expect(coverage.totalLedgerCount).toBe('39');
		expect(coverage.contiguousLastLedger).toBe('10');
		expect(isHubbleLedgerWindowComplete(coverage, 100, 119)).toBe(true);
		expect(isHubbleLedgerWindowComplete(coverage, 140, 149)).toBe(true);
		for (const checkpoint of [120, 130, 150])
			expect(
				isHubbleLedgerWindowComplete(coverage, checkpoint, checkpoint)
			).toBe(false);
	});
});
