import { mock } from 'jest-mock-extended';
import { classifyHubbleEventRows } from '../HubbleEventRelationshipQuery.js';
import type { HubbleSemanticQueryExecutor } from '../HubbleSemanticWarehouse.js';

describe('page-bounded event relationship lookup', () => {
	it('uses one query for repeated events, exact ledger/transaction keys and published source evidence', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble_v2',
			maximumRows: 200
		});
		executor.execute.mockResolvedValue({
			data: [
				{
					kind: 'transaction',
					transaction_id: '100',
					ledger_sequence: 123,
					operation_count: 1,
					operations: []
				},
				{
					kind: 'operations',
					transaction_id: '100',
					ledger_sequence: 123,
					operation_count: null,
					operations: [['101', 24]]
				}
			]
		});
		const event = {
			transaction_id: '100',
			ledger_sequence: 123,
			operation_id: null,
			type: 2
		};
		const rows = await classifyHubbleEventRows(executor, [event, event]);
		expect(
			rows.map((row) => row.classification.sorobanExecutionEvidence)
		).toEqual([true, true]);
		expect(executor.execute).toHaveBeenCalledTimes(1);
		const [sql, parameters] = executor.execute.mock.calls[0]!;
		expect(sql).toContain(
			'(ledger_sequence,id) IN (({ledger0:UInt32},{transaction0:Int64}))'
		);
		expect(sql).toContain(
			'(o.ledger_sequence,o.transaction_id) IN (({ledger0:UInt32},{transaction0:Int64}))'
		);
		expect(sql).toContain('ledger_sequence IN ({ledger0:UInt32})');
		expect(sql.match(/HAVING tupleElement/g)).toHaveLength(2);
		expect(parameters).toHaveLength(2);
		expect(sql).toContain('_ledger_sequence IN ({ledger0:UInt32})');
		expect(sql).toContain('groupUniqArray(101)');
		expect(sql).toContain('LIMIT 3');
		expect(sql).not.toContain('SETTINGS');
	});

	it('does not classify a response that hit its completeness sentinel', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble',
			maximumRows: 200
		});
		executor.execute.mockResolvedValue({ data: [{}, {}, {}] });
		const [row] = await classifyHubbleEventRows(executor, [
			{
				transaction_id: '100',
				ledger_sequence: 123,
				type: 1
			}
		]);
		expect(row?.classification.provenance).toBe('incomplete');
		expect(row?.classification.transactionKind).toBe('unknown');
	});

	it('retains unknown for missing or incomplete transaction relationships', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble',
			maximumRows: 200
		});
		executor.execute.mockResolvedValue({
			data: [
				{
					kind: 'transaction',
					transaction_id: '100',
					ledger_sequence: 123,
					operation_count: 2,
					operations: []
				},
				{
					kind: 'operations',
					transaction_id: '100',
					ledger_sequence: 123,
					operation_count: null,
					operations: [['101', 25]]
				}
			]
		});
		const rows = await classifyHubbleEventRows(executor, [
			{ transaction_id: '100', ledger_sequence: 123, type: 1 },
			{ transaction_id: '200', ledger_sequence: 123, type: 1 }
		]);
		expect(rows.map((row) => row.classification.provenance)).toEqual([
			'incomplete',
			'missing'
		]);
		expect(
			rows.every((row) => !row.classification.sorobanExecutionEvidence)
		).toBe(true);
	});

	it('does not query without valid identities, and obeys the existing configured page bound', async () => {
		const executor = mock<HubbleSemanticQueryExecutor>({
			database: 'stellar_hubble',
			maximumRows: 1
		});
		const [row] = await classifyHubbleEventRows(executor, [
			{ type: 1, topics_decoded: [{ symbol: 'fee' }] }
		]);
		expect(row?.classification).toEqual({
			transactionKind: 'unknown',
			eventKind: 'unknown',
			sorobanExecutionEvidence: false,
			provenance: 'missing'
		});
		expect(executor.execute).not.toHaveBeenCalled();
		await expect(classifyHubbleEventRows(executor, [{}, {}])).rejects.toThrow(
			'configured maximum'
		);
	});
});
