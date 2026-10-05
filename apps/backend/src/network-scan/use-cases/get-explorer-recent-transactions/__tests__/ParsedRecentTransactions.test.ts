import { mock } from 'jest-mock-extended';
import type {
	HubbleWarehouse,
	HubbleCatalog
} from '../../../../status/infrastructure/http/HubbleWarehouseContracts.js';
import type { GetExplorerLocalTransactions } from '../../get-explorer-local-transactions/GetExplorerLocalTransactions.js';
import {
	GetExplorerRecentTransactions,
	type ExplorerLiveTransactionFeed
} from '../GetExplorerRecentTransactions.js';
import { fetchParsedRecentTransactions } from '../ParsedRecentTransactions.js';

const now = new Date('2026-10-05T12:00:00Z');
const record = (
	createdAt: string
): ExplorerLiveTransactionFeed['records'][number] => ({
	createdAt,
	feeCharged: '100',
	hash: 'a'.repeat(64),
	ledger: '64760000',
	operationCount: 1,
	sourceAccount: 'G' + 'A'.repeat(55),
	successful: true
});

describe('Parsed recent transaction feed', () => {
	it('reads only a bounded published tail and normalizes UTC and exact integers', async () => {
		const warehouse = mock<HubbleWarehouse>();
		const catalog = mock<HubbleCatalog>();
		warehouse.catalog.mockResolvedValue({
			...catalog,
			ingestion: {
				completedBatches: '1',
				failedBatches: '0',
				maximumLedger: '64760000',
				minimumLedger: '64759000',
				startedBatches: '0',
				totalRows: '3'
			}
		});
		warehouse.query.mockResolvedValue({
			columns: [],
			dataset: 'history_transactions',
			elapsedMilliseconds: 1,
			limit: 2,
			offset: 0,
			rows: [1, 2].map(() => ({
				transaction_hash: 'a'.repeat(64),
				ledger_sequence: 64760000,
				closed_at: '2026-10-05 11:59:59.123456',
				fee_charged: '9007199254740993',
				operation_count: 1,
				account: 'G' + 'A'.repeat(55),
				successful: true
			}))
		});
		const result = await fetchParsedRecentTransactions(warehouse, 1);
		expect(result.truncated).toBe(true);
		expect(result.records).toHaveLength(1);
		expect(result.records[0]).toMatchObject({
			createdAt: '2026-10-05T11:59:59.123Z',
			feeCharged: '9007199254740993'
		});
		expect(warehouse.query).toHaveBeenCalledWith(
			expect.objectContaining({
				filters: [
					{ field: '_ledger_sequence', operator: 'gte', value: 64757953 },
					{ field: '_ledger_sequence', operator: 'lte', value: 64760000 }
				],
				limit: 2
			})
		);
	});
	it('does not query rows without a completed watermark', async () => {
		const warehouse = mock<HubbleWarehouse>();
		const catalog = mock<HubbleCatalog>();
		warehouse.catalog.mockResolvedValue({
			...catalog,
			ingestion: {
				completedBatches: '0',
				failedBatches: '0',
				maximumLedger: null,
				minimumLedger: null,
				startedBatches: '1',
				totalRows: '0'
			}
		});
		expect(await fetchParsedRecentTransactions(warehouse, 20)).toEqual({
			records: [],
			truncated: false
		});
		expect(warehouse.query).not.toHaveBeenCalled();
	});
	it('rejects an unbounded request before reading the warehouse', async () => {
		const warehouse = mock<HubbleWarehouse>();
		await expect(
			fetchParsedRecentTransactions(warehouse, 1000)
		).rejects.toThrow('Invalid feed limit');
		expect(warehouse.catalog).not.toHaveBeenCalled();
	});
	it('serves fresh parsed records without PostgreSQL or Horizon reads', async () => {
		const local = mock<Pick<GetExplorerLocalTransactions, 'execute'>>();
		const live = jest.fn<Promise<ExplorerLiveTransactionFeed>, [number]>();
		const useCase = new GetExplorerRecentTransactions({
			getLocalTransactions: local,
			fetchParsedTransactions: async () => ({
				records: [record('2026-10-05T11:59:59Z')],
				truncated: false
			}),
			fetchLiveTransactions: live,
			freshnessWindowMs: 300000,
			now: () => now
		});
		expect(await useCase.execute(20)).toMatchObject({
			source: 'local_history',
			selectionReason: 'local_history_current',
			freshness: 'fresh'
		});
		expect(local.execute).not.toHaveBeenCalled();
		expect(live).not.toHaveBeenCalled();
	});
	it('keeps newer parsed records instead of replacing them with an older Horizon feed', async () => {
		const useCase = new GetExplorerRecentTransactions({
			getLocalTransactions: mock<GetExplorerLocalTransactions>(),
			fetchParsedTransactions: async () => ({
				records: [record('2026-10-05T11:00:00Z')],
				truncated: true
			}),
			fetchLiveTransactions: async () => ({
				records: [record('2026-09-26T08:19:59Z')],
				truncated: true
			}),
			freshnessWindowMs: 300000,
			now: () => now
		});
		expect(await useCase.execute(20)).toMatchObject({
			dataThrough: '2026-10-05T11:00:00.000Z',
			source: 'local_history',
			selectionReason: 'local_history_newer',
			freshness: 'stale'
		});
	});
	it('uses Horizon when it is genuinely newer', async () => {
		const useCase = new GetExplorerRecentTransactions({
			getLocalTransactions: mock<GetExplorerLocalTransactions>(),
			fetchParsedTransactions: async () => ({
				records: [record('2026-10-05T11:00:00Z')],
				truncated: true
			}),
			fetchLiveTransactions: async () => ({
				records: [record('2026-10-05T11:59:59Z')],
				truncated: true
			}),
			freshnessWindowMs: 300000,
			now: () => now
		});
		expect(await useCase.execute(20)).toMatchObject({
			source: 'live_network',
			selectionReason: 'local_history_behind',
			freshness: 'fresh'
		});
	});
	it('preserves dated parsed rows if Horizon is unavailable', async () => {
		const useCase = new GetExplorerRecentTransactions({
			getLocalTransactions: mock<GetExplorerLocalTransactions>(),
			fetchParsedTransactions: async () => ({
				records: [record('2026-10-05T11:00:00Z')],
				truncated: true
			}),
			fetchLiveTransactions: async () => {
				throw new Error('unavailable');
			},
			freshnessWindowMs: 300000,
			now: () => now
		});
		expect(await useCase.execute(20)).toMatchObject({
			source: 'local_history',
			selectionReason: 'live_network_unavailable',
			freshness: 'stale'
		});
	});
});
