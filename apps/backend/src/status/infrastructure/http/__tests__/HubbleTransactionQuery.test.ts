import { queryHubbleTransactionDetail } from '../HubbleTransactionQuery.js';
import {
	decodeTransactionCursor,
	normalizeTransactionInput
} from '../HubbleTransactionCursor.js';
import {
	queryFixture,
	transactionHash,
	transactionId,
	transactionLedger,
	exactOperationAmount
} from './HubbleTransactionFixture.js';

describe('typed transaction details', () => {
	it('returns exact envelope/effect amounts, UTC dates and classified independently paged relations', async () => {
		const { executor, calls } = queryFixture();
		const input = {
			transactionHash,
			ledgerSequence: transactionLedger,
			limit: 1
		};
		const first = await queryHubbleTransactionDetail(executor, input);
		expect(first!.transaction.sequence).toBe('9007199254740993');
		expect(first!.transaction.closedAt).toBe('2026-09-01T00:00:00.000Z');
		expect(first!.operations.items[0]!.amounts).toContainEqual({
			field: 'amount',
			decimal: exactOperationAmount,
			raw: '9007199254740993',
			scale: 7,
			source: 'envelope'
		});
		expect(first!.effects.items[0]!.amounts[0]!.raw).toBe('9007199254740993');
		expect(first!.events.items[0]!.classification).toMatchObject({
			transactionKind: 'classic',
			eventKind: 'fee',
			provenance: 'complete',
			sorobanExecutionEvidence: false
		});
		expect(first!.operations.nextCursor).not.toBeNull();
		expect(first!.effects.nextCursor).not.toBeNull();
		expect(first!.events.nextCursor).not.toBeNull();
		const second = await queryHubbleTransactionDetail(executor, {
			...input,
			operationsAfter: first!.operations.nextCursor!,
			effectsAfter: first!.effects.nextCursor!,
			eventsAfter: first!.events.nextCursor!
		});
		expect(second!.operations.items[0]!.index).toBe(1);
		expect(second!.effects.items[0]!.index).toBe(1);
		expect(second!.events.items[0]!.operationId).toBe(
			(BigInt(transactionId) + 1n).toString()
		);
		expect(second!.operations.nextCursor).toBeNull();
		expect(second!.effects.nextCursor).not.toBeNull();
		for (const call of calls.filter(
			(c) => !c.sql.includes("SELECT 'transaction' AS kind")
		)) {
			expect(call.sql).toContain('ledger_sequence = {ledger:UInt32}');
			expect(call.sql).toContain('_ledger_sequence = {ledger:UInt32}');
			expect(call.sql).toContain('_source_sha256');
			expect(call.sql).not.toContain('OFFSET');
			expect(call.sql).not.toContain('SETTINGS');
		}
	});
	it('supports hash-only lookup, then scopes relationships to the resolved ledger', async () => {
		const { executor, calls } = queryFixture();
		await queryHubbleTransactionDetail(executor, { transactionHash });
		expect(calls[0]!.parameters.map((p) => p.name)).toEqual(['hash']);
		expect(
			calls
				.slice(1)
				.some((c) =>
					c.parameters.some(
						(p) => p.name === 'ledger' && p.value === String(transactionLedger)
					)
				)
		).toBe(true);
	});
	it('rejects cursor replay across relation, hash and ledger and validates input before execution', async () => {
		const { executor, calls } = queryFixture();
		const page = await queryHubbleTransactionDetail(executor, {
			transactionHash,
			limit: 1
		});
		const scope = {
			hash: transactionHash,
			ledger: transactionLedger,
			transactionId,
			relation: 'effects' as const
		};
		expect(() =>
			decodeTransactionCursor(page!.operations.nextCursor!, scope)
		).toThrow('cursor');
		expect(() =>
			decodeTransactionCursor(page!.effects.nextCursor!, {
				...scope,
				hash: 'f'.repeat(64)
			})
		).toThrow('cursor');
		expect(() =>
			decodeTransactionCursor(page!.effects.nextCursor!, {
				...scope,
				ledger: transactionLedger + 1
			})
		).toThrow('cursor');
		for (const limit of [0, 201, 1.5])
			expect(() =>
				normalizeTransactionInput({ transactionHash, limit })
			).toThrow('limit');
		expect(() =>
			normalizeTransactionInput({ transactionHash: 'invalid' })
		).toThrow('hash');
		expect(calls.length).toBeGreaterThan(0);
	});
	it('rejects oversized responses and does not promote float-only details when envelope decoding fails', async () => {
		const { executor } = queryFixture();
		const execute = executor.execute.bind(executor);
		const oversized = {
			...executor,
			execute: async <T>(sql: string, p: Parameters<typeof execute>[1]) => {
				const result = await execute<T>(sql, p);
				return sql.includes('.history_transactions')
					? { data: [...result.data!, ...result.data!] }
					: result;
			}
		};
		await expect(
			queryHubbleTransactionDetail(oversized, { transactionHash })
		).rejects.toThrow('oversized');
	});
});
