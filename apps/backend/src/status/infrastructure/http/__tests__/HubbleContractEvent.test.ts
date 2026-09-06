import express from 'express';
import request from 'supertest';
import { mock } from 'jest-mock-extended';
import { queryHubbleContractEvents } from '../HubbleContractEventQuery.js';
import { normalizeHubbleContractEventInput } from '../HubbleContractEventValidation.js';
import { summarizeHubbleLedgerCoverage } from '../HubbleLedgerCoverage.js';
import { hubbleWarehouseRouter } from '../HubbleWarehouseRouter.js';
import { hubbleWarehouseGraphqlHandler } from '../HubbleWarehouseGraphql.js';
import type { HubbleWarehouse } from '../HubbleWarehouseContracts.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
import {
	eventFixtures,
	queryFixture,
	transactionLedger,
	transactionHash
} from './HubbleTransactionFixture.js';

export const contractId = eventFixtures[0]!.contract_id;
export const coverage = summarizeHubbleLedgerCoverage([
	{ start_ledger: 2, end_ledger: transactionLedger }
]);
export function fixture() {
	const relationships = queryFixture().executor;
	const calls: {
		sql: string;
		parameters: readonly HubblePreparedParameter[];
	}[] = [];
	const executor: HubbleSemanticQueryExecutor = {
		database: 'fixture',
		maximumRows: 200,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			calls.push({ sql, parameters });
			if (sql.includes("SELECT 'transaction' AS kind"))
				return relationships.execute<T>(sql, parameters);
			const param = (name: string) =>
				parameters.find((p) => p.name === name)?.value;
			const rows = [...eventFixtures]
				.reverse()
				.map((row) => ({
					...row,
					cursor_row: row._row_number,
					cursor_batch: row._batch_id,
					cursor_digest: row._source_sha256
				}))
				.filter(
					(row) =>
						!param('after_row') ||
						BigInt(row.cursor_row) < BigInt(param('after_row')!)
				);
			return {
				data: rows.slice(0, Number(param('row_limit'))) as unknown as T[]
			};
		}
	};
	return { executor, calls };
}
describe('bounded typed contract history', () => {
	it('pages descending exact identities with filter-bound watermark and published predicates', async () => {
		const { executor, calls } = fixture();
		const input = {
			contractId,
			minLedger: transactionLedger,
			maxLedger: transactionLedger,
			limit: 1
		};
		const first = await queryHubbleContractEvents(executor, input, coverage);
		const second = await queryHubbleContractEvents(
			executor,
			{ ...input, after: first.nextCursor! },
			coverage
		);
		expect(first.items[0]!.id).not.toBe(second.items[0]!.id);
		expect(second.nextCursor).toBeNull();
		expect(second.watermark).toEqual(first.watermark);
		expect(first.items[0]).toMatchObject({
			transactionId: eventFixtures[0]!.transaction_id,
			closedAt: '2026-09-01T00:00:00.000Z',
			dataJson: '{"i128":"9007199254740993"}'
		});
		expect(second.items[0]!.classification).toMatchObject({
			eventKind: 'fee',
			sorobanExecutionEvidence: false,
			provenance: 'complete'
		});
		expect(calls[0]!.sql).toContain(
			'_ledger_sequence >= {minimum_ledger:UInt32}'
		);
		expect(calls[0]!.sql).toContain(
			'ledger_sequence >= {minimum_ledger:UInt32}'
		);
		expect(calls[0]!.sql).toContain('_ingestion_batches');
		expect(calls[2]!.sql).toContain('tuple(_ledger_sequence, _row_number');
		await expect(
			queryHubbleContractEvents(
				executor,
				{ ...input, successful: false, after: first.nextCursor! },
				coverage
			)
		).rejects.toThrow('cursor');
		const forged = JSON.parse(
			Buffer.from(first.nextCursor!, 'base64url').toString()
		) as { watermark: { maximumLedger: number } };
		forged.watermark.maximumLedger += 1;
		await expect(
			queryHubbleContractEvents(
				executor,
				{
					...input,
					after: Buffer.from(JSON.stringify(forged)).toString('base64url')
				},
				coverage
			)
		).rejects.toThrow();
	});
	it('uses native exact predicates for dates, hash, event type and success without numeric event coercion', async () => {
		const { executor, calls } = fixture();
		await queryHubbleContractEvents(
			executor,
			{
				contractId,
				minLedger: transactionLedger,
				maxLedger: transactionLedger,
				transactionHash: transactionHash.toUpperCase(),
				typeCode: 2,
				successful: false,
				inSuccessfulContractCall: false,
				startTime: '2026-09-01T00:00:00Z',
				endTime: '2026-09-02T00:00:00Z',
				limit: 2
			},
			coverage
		);
		expect(calls[0]!.parameters).toEqual(
			expect.arrayContaining([
				{ name: 'transactionHash', type: 'String', value: transactionHash },
				{ name: 'typeCode', type: 'Int32', value: '2' },
				{ name: 'successful', type: 'Bool', value: '0' },
				{ name: 'inSuccessfulContractCall', type: 'Bool', value: '0' }
			])
		);
		expect(calls[0]!.sql).toContain('closed_at < parseDateTime64BestEffort(');
		expect(calls[0]!.sql).not.toContain('SETTINGS');
	});
	it.each([
		{ typeCode: 3 },
		{ successful: 'false' },
		{ inSuccessfulContractCall: 1 },
		{ startTime: '2026-09-01' },
		{ minLedger: 1, maxLedger: 1000001 },
		{ limit: 201 },
		{ account: 'ignored' }
	])('rejects invalid or ignored filter %j', (extra) => {
		expect(() =>
			normalizeHubbleContractEventInput({ contractId, ...extra } as never)
		).toThrow();
	});
	it('returns explicit ingestion coverage with empty unpublished ranges and rejects missing result data', async () => {
		const { executor, calls } = fixture();
		const page = await queryHubbleContractEvents(
			executor,
			{
				contractId,
				minLedger: transactionLedger + 1,
				maxLedger: transactionLedger + 2
			},
			coverage
		);
		expect(page.items).toEqual([]);
		expect(page.coverage).toEqual(coverage);
		expect(calls).toHaveLength(0);
		await expect(
			queryHubbleContractEvents(
				{ ...executor, execute: async () => ({}) },
				{
					contractId,
					minLedger: transactionLedger,
					maxLedger: transactionLedger
				},
				coverage
			)
		).rejects.toThrow('Incomplete');
	});
	it('shares normalized REST and GraphQL filters while keeping the legacy event shape', async () => {
		const w = mock<HubbleWarehouse>();
		const page = await queryHubbleContractEvents(
			fixture().executor,
			{ contractId, limit: 1 },
			coverage
		);
		w.contractEvents.mockResolvedValue(page);
		w.query.mockResolvedValue({
			rows: [],
			columns: [],
			dataset: 'history_contract_events',
			limit: 2,
			offset: 0,
			elapsedMilliseconds: 0
		});
		w.classifyEventRows.mockResolvedValue([]);
		const app = express();
		app.use(express.json());
		app.use('/v1/analytics', hubbleWarehouseRouter({ warehouse: w }));
		app.all('/graphql', hubbleWarehouseGraphqlHandler(w));
		const rest = await request(app)
			.get(
				'/v1/analytics/contracts/' +
					contractId +
					'/events?view=typed&min_ledger=26000000&max_ledger=26000000&successful=false&type_code=2&limit=1'
			)
			.expect(200);
		const restInput = w.contractEvents.mock.calls[0]![0];
		const graphql = await request(app)
			.post('/graphql')
			.send({
				query:
					'query($contract: String!) { hubbleContractEvents(contractId: $contract, input: {minLedger:26000000,maxLedger:26000000,successful:false,typeCode:2,limit:1}) { contractId limit nextCursor items { id transactionId dataJson closedAt classification { eventKind sorobanExecutionEvidence } } coverage { maximumLedger } } }',
				variables: { contract: contractId }
			})
			.expect(200);
		expect(graphql.body.errors).toBeUndefined();
		expect(w.contractEvents.mock.calls[1]![0]).toEqual(restInput);
		expect(graphql.body.data.hubbleContractEvents.items[0].id).toBe(
			rest.body.items[0].id
		);
		await request(app)
			.get('/v1/analytics/contracts/' + contractId + '/events?limit=2')
			.expect(200)
			.expect((r) => {
				expect(r.body.rows).toEqual([]);
				expect(r.body.items).toBeUndefined();
			});
		const before = w.contractEvents.mock.calls.length;
		for (const invalid of [
			'successful=0',
			'limit=1&limit=2',
			'offset=1',
			'type_code=3'
		])
			await request(app)
				.get(
					'/v1/analytics/contracts/' +
						contractId +
						'/events?view=typed&' +
						invalid
				)
				.expect(400);
		expect(w.contractEvents).toHaveBeenCalledTimes(before);
	});
});
