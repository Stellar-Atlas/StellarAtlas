import { queryHubbleContractEvents } from '../HubbleContractEventQuery.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';

const contractId = 'C' + 'A'.repeat(55);
const address = 'G' + 'A'.repeat(55);

describe('queryHubbleContractEvents extensions', () => {
	it('filters and orders events while caching a matched-selection summary', async () => {
		const statements: {
			sql: string;
			parameters: readonly HubblePreparedParameter[];
		}[] = [];
		const executor: HubbleSemanticQueryExecutor = {
			database: 'stellar_hubble_test',
			maximumRows: 200,
			async execute<T>(
				sql: string,
				parameters: readonly HubblePreparedParameter[]
			) {
				statements.push({ sql, parameters });
				if (sql.includes('sumMap(topic_keys, topic_values)'))
					return {
						data: [
							{
								total: '2',
								topic_keys: ['transfer', 'approve'],
								topic_counts: ['2', '1']
							}
						] as T[]
					};
				if (sql.includes('ORDER BY _ledger_sequence')) {
					if (sql.includes('after_ledger')) return { data: [] as T[] };
					return {
						data: [
							eventRow('1', '00000000-0000-4000-8000-000000000001', '1'),
							eventRow('2', '00000000-0000-4000-8000-000000000002', '2')
						] as T[]
					};
				}
				return { data: [] as T[] };
			}
		};
		const coverage = {
			contiguousFirstLedger: '2',
			contiguousLastLedger: '5000000',
			contiguousLedgerCount: '4999999',
			supplementalLedgerCount: '0',
			totalLedgerCount: '4999999',
			nextLedger: '5000001',
			minimumLedger: '2',
			maximumLedger: '5000000',
			gapCount: 0
		};
		const request = {
			contractId,
			order: 'asc' as const,
			topic: 'transfer',
			search: address,
			includeSummary: true,
			limit: 1
		};
		const first = await queryHubbleContractEvents(executor, request, coverage);
		const second = await queryHubbleContractEvents(
			executor,
			{ ...request, after: first.nextCursor! },
			coverage
		);

		expect(first.summary).toEqual({
			total: '2',
			topics: [
				{ topic: 'transfer', count: '2' },
				{ topic: 'approve', count: '1' }
			]
		});
		expect(second.summary).toEqual(first.summary);
		expect(
			statements.filter(({ sql }) => sql.includes('sumMap('))
		).toHaveLength(1);
		const eventQuery = statements.find(({ sql }) =>
			sql.includes('ORDER BY _ledger_sequence')
		)!;
		expect(eventQuery.sql).toContain('ORDER BY _ledger_sequence ASC');
		expect(eventQuery.sql).toContain('position(topics_decoded');
		expect(eventQuery.sql).toContain('position(data_decoded');
		expect(eventQuery.sql).toContain('JSONExtractArrayRaw(topics_decoded)');
		expect(eventQuery.parameters).toContainEqual(
			expect.objectContaining({ name: 'minimum_ledger', value: '2' })
		);
		expect(eventQuery.parameters).toContainEqual(
			expect.objectContaining({ name: 'search_address', value: address })
		);
		const nextQuery = statements.filter(({ sql }) =>
			sql.includes('ORDER BY _ledger_sequence')
		)[1]!;
		expect(nextQuery.sql).toContain(') > tuple(');
	});
});

function eventRow(row: string, batch: string, transactionId: string) {
	return {
		transaction_id: transactionId,
		ledger_sequence: 5,
		cursor_row: row,
		cursor_batch: batch,
		cursor_digest: 'a'.repeat(64),
		transaction_hash: 'b'.repeat(64),
		closed_at: '2026-01-01T00:00:00.000Z',
		operation_id: null,
		contract_id: contractId,
		type: 1,
		type_string: 'contract',
		successful: true,
		in_successful_contract_call: true,
		topics_decoded: '[]',
		data_decoded: '{}',
		contract_event_xdr: 'AAAA'
	};
}
