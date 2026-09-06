import { ClickHouseHubbleWarehouse } from '../HubbleWarehouseClient.js';
const liveTest =
	process.env.HUBBLE_TEST_LIVE_SAMPLE === '1' ? describe : describe.skip;
// Explicit opt-in: completed metadata plus one known modern ledger only; never writes.
liveTest('known published contract-history sample', () => {
	it('returns typed failed diagnostics with stable continuation from actual parsed Dynamic data', async () => {
		const warehouse = new ClickHouseHubbleWarehouse({
			endpoint: process.env.HUBBLE_TEST_CLICKHOUSE_URL!,
			user: process.env.HUBBLE_TEST_CLICKHOUSE_USER,
			password: process.env.HUBBLE_TEST_CLICKHOUSE_PASSWORD,
			database:
				process.env.HUBBLE_TEST_CLICKHOUSE_DATABASE ?? 'stellar_hubble_v2'
		});
		const input = {
			contractId: 'CDL74RF5BLYR2YBLCCI7F5FB6TPSCLKEJUBSD2RSVWZ4YHF3VMFAIGWA',
			minLedger: 63490364,
			maxLedger: 63490364,
			typeCode: 2,
			successful: false,
			limit: 1
		};
		const first = await warehouse.contractEvents(input);
		expect(first.items).toHaveLength(1);
		expect(first.nextCursor).not.toBeNull();
		const second = await warehouse.contractEvents({
			...input,
			after: first.nextCursor!
		});
		expect(second.items).toHaveLength(1);
		expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
		expect(second.watermark).toEqual(first.watermark);
		expect(first.items[0]).toMatchObject({
			ledgerSequence: 63490364,
			successful: false,
			typeCode: 2,
			classification: {
				transactionKind: 'soroban',
				eventKind: 'diagnostic',
				sorobanExecutionEvidence: true,
				provenance: 'complete'
			}
		});
		expect(first.items[0]!.closedAt).toMatch(/Z$/);
		expect(first.items[0]!.transactionId).toMatch(/^[0-9]+$/);
		expect(first.items[0]!.eventXdr.length).toBeGreaterThan(0);
		expect(first.coverage.gapCount).toBeGreaterThan(0);
	}, 45000);
});
