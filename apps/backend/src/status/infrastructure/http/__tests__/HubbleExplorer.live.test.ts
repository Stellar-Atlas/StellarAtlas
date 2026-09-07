import { ClickHouseHubbleWarehouse } from '../HubbleWarehouseClient.js';
import { queryExplorer } from '../HubbleExplorerQuery.js';
import type { ExplorerEntity } from '../HubbleExplorerMapper.js';

// Explicit opt-in: at most one page from one already-published ledger per entity.
// Never writes data, starts services, or scans unbounded historical tables.
const live =
	process.env.HUBBLE_EXPLORER_LIVE_ACCEPTANCE === '1'
		? describe
		: describe.skip;
live('published modern explorer acceptance', () => {
	const warehouse = new ClickHouseHubbleWarehouse({
		endpoint: process.env.HUBBLE_TEST_CLICKHOUSE_URL ?? 'http://127.0.0.1:8123',
		database: 'stellar_hubble_v2',
		user: process.env.HUBBLE_TEST_CLICKHOUSE_USER,
		password: process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD
	});
	for (const entity of [
		'operations',
		'assets',
		'contracts',
		'trades',
		'offers'
	] as const) {
		it(
			'reads one bounded real ' + entity + ' page',
			async () => {
				const ledger = entity === 'contracts' ? 63491202 : 63490364;
				const result = await queryExplorer(warehouse, {
					entity,
					filters: {},
					minLedger: ledger,
					maxLedger: ledger,
					limit: 1
				});
				expect(result.window).toEqual({ minLedger: ledger, maxLedger: ledger });
				expect(result.coverageStatus).toBe('complete');
				expect(result.coverage).toMatchObject({ gapCount: 1 });
				expect(Array.isArray(result.rows)).toBe(true);
				const rows = result.rows as Record<string, unknown>[];
				expect(rows).toHaveLength(1);
				expect(typeof rows[0]!.id).toBe('string');
				if (entity === 'operations')
					expect(rows[0]!.transactionHash).toMatch(/^[a-f0-9]{64}$/);
				if (entity === 'offers' || entity === 'trades')
					expect(rows[0]!.amountPrecision).toBe('source_float64');
			},
			30000
		);
	}
	it('resolves the published real invocation by exact operation ID', async () => {
		const result = await queryExplorer(warehouse, {
			entity: 'operations',
			filters: {},
			id: '272689036992143361'
		});
		expect(result.record).toMatchObject({
			id: '272689036992143361',
			type: 'invoke_host_function',
			typeCode: 24,
			transactionHash:
				'446670351d9f2af449eda3bfa0e36c3e128e2720443293dd5b585b3bbadeb485'
		});
	}, 30000);

	it('opens the actual invoked contract at its event ledger, before the state batch snapshot', async () => {
		const result = await queryExplorer(warehouse, {
			entity: 'contracts',
			filters: {},
			id: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA',
			minLedger: 63490364,
			maxLedger: 63490364
		});
		expect(result.record).toEqual({
			id: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA'
		});
	}, 30000);
});
