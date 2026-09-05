import { completedHubbleBatchPredicate } from '../HubbleBatchVisibility.js';
import {
	decodeTransferCursor,
	encodeTransferCursor,
	transferFilterFingerprint
} from '../HubbleTransferCursor.js';
import { queryHubbleTransferActivity } from '../HubbleTransferQuery.js';
import { normalizeHubbleTransferInput } from '../HubbleTransferValidation.js';
import { HubbleWarehouseInputError } from '../HubbleWarehouseErrors.js';
import type {
	HubblePreparedParameter,
	HubbleSemanticQueryExecutor
} from '../HubbleSemanticWarehouse.js';
import {
	exactTransferAmount,
	transferAccount,
	transferRow
} from './HubbleTransferFixture.js';

function fixture(rows: readonly Record<string, unknown>[] = [transferRow()]) {
	const requests: {
		sql: string;
		parameters: readonly HubblePreparedParameter[];
	}[] = [];
	const executor: HubbleSemanticQueryExecutor = {
		database: 'stellar_hubble',
		maximumRows: 200,
		async execute<T>(
			sql: string,
			parameters: readonly HubblePreparedParameter[]
		) {
			requests.push({ sql, parameters });
			return { data: rows as readonly T[] };
		}
	};
	return { executor, requests };
}
describe('bounded exact transfer activity', () => {
	it('uses published digests, exact Int128 filters, bounded partitions, dates, and server budgets', async () => {
		const { executor, requests } = fixture();
		const page = await queryHubbleTransferActivity(
			executor,
			{
				account: transferAccount,
				asset: 'native',
				eventTopic: 'transfer',
				minLedger: 10,
				maxLedger: 65,
				amountRaw: exactTransferAmount,
				startTime: '2026-09-01T00:00:00Z',
				endTime: '2026-09-02T00:00:00Z'
			},
			70
		);
		const query = requests[0]!;
		expect(query.sql).toContain(
			completedHubbleBatchPredicate('stellar_hubble')
		);
		expect(query.sql).toContain('_ledger_sequence >= {minimum_ledger:UInt32}');
		expect(query.sql).toContain('_ledger_sequence <= {maximum_ledger:UInt32}');
		expect(query.sql).toContain(
			'toInt128OrNull(amount_raw) = {amountRaw:Int128}'
		);
		expect(query.sql).toContain('OR to_muxed = {account:String}');
		expect(query.sql).not.toContain('SETTINGS');
		expect(query.sql).toContain('LIMIT {row_limit:UInt32}');
		expect(query.parameters).toContainEqual({
			name: 'amountRaw',
			type: 'Int128',
			value: exactTransferAmount
		});
		expect(query.parameters).toContainEqual({
			name: 'startTime',
			type: 'String',
			value: '2026-09-01T00:00:00.000Z'
		});
		expect(page.transfers[0]).toMatchObject({
			amountRaw: exactTransferAmount,
			amountScale: 7,
			eventTopic: 'transfer',
			transactionId: '9007199254740993',
			operationId: '9007199254740994'
		});
		expect(page.watermark).toMatchObject({
			minimumLedger: 10,
			maximumLedger: 65,
			coverage: 'ingested-only'
		});
		expect(page.nextCursor).toBeNull();
	});

	it('uses a lookahead and the full numeric/key tuple with a pinned ledger window', async () => {
		const { executor, requests } = fixture([
			transferRow(),
			transferRow({ cursor_row: '9' })
		]);
		const input = { minLedger: 10, maxLedger: 65, limit: 1 };
		const first = await queryHubbleTransferActivity(executor, input, 70);
		expect(first.transfers).toHaveLength(1);
		expect(first.nextCursor).not.toBeNull();
		const decoded = decodeTransferCursor(
			first.nextCursor!,
			transferFilterFingerprint(normalizeHubbleTransferInput(input))
		);
		expect(decoded.position).toMatchObject({ ledger: 63, row: '10' });
		const second = await queryHubbleTransferActivity(
			executor,
			{ ...input, after: first.nextCursor! },
			100
		);
		expect(second.watermark).toEqual(first.watermark);
		expect(requests[1]!.sql).toContain(
			'tuple(_ledger_sequence, _row_number, toString(_batch_id), toString(_source_sha256)) < tuple('
		);
		expect(requests[1]!.sql).toContain(
			'ORDER BY _ledger_sequence DESC, _row_number DESC'
		);
		expect(requests[1]!.sql).not.toContain('AS _row_number');
		expect(requests[1]!.parameters).toContainEqual({
			name: 'after_row',
			type: 'UInt64',
			value: '10'
		});
		await expect(
			queryHubbleTransferActivity(
				executor,
				{ ...input, asset: 'native', after: first.nextCursor! },
				100
			)
		).rejects.toThrow('cursor');
	});

	it('rejects forged cursor bounds and out-of-range positions', async () => {
		const { executor } = fixture([
			transferRow(),
			transferRow({ cursor_row: '9' })
		]);
		const input = { minLedger: 10, maxLedger: 65, limit: 1 };
		const first = await queryHubbleTransferActivity(executor, input, 70);
		const cursor = decodeTransferCursor(
			first.nextCursor!,
			transferFilterFingerprint(normalizeHubbleTransferInput(input))
		);
		for (const watermark of [
			{ ...cursor.watermark, minimumLedger: 11 },
			{ ...cursor.watermark, maximumLedger: 66 },
			{ ...cursor.watermark, maximumLedger: 71 }
		]) {
			await expect(
				queryHubbleTransferActivity(
					executor,
					{ ...input, after: encodeTransferCursor({ ...cursor, watermark }) },
					70
				)
			).rejects.toThrow('cursor');
		}
		await expect(
			queryHubbleTransferActivity(
				executor,
				{
					...input,
					after: encodeTransferCursor({
						...cursor,
						position: { ...cursor.position, row: '18446744073709551616' }
					})
				},
				70
			)
		).rejects.toThrow('cursor');
	});

	it('reports the bounded default window and does not imply complete coverage', async () => {
		const { executor, requests } = fixture([]);
		const page = await queryHubbleTransferActivity(executor, {}, 26_000_099);
		expect(page.watermark.minimumLedger).toBe(25_900_100);
		expect(page.watermark.maximumLedger).toBe(26_000_099);
		expect(requests[0]!.parameters).toContainEqual({
			name: 'row_limit',
			type: 'UInt32',
			value: '101'
		});
		expect(page.transfers).toEqual([]);
	});

	it('preserves negative signed-i128 observations without implying valid token execution', async () => {
		const { executor } = fixture([
			transferRow({
				amount_raw: '-170141183460469231731687303715884105728',
				asset_type: ''
			})
		]);
		const page = await queryHubbleTransferActivity(executor, {}, 70);
		expect(page.transfers[0]!.amountRaw).toBe(
			'-170141183460469231731687303715884105728'
		);
		expect(page.transfers[0]!.amountScale).toBeNull();
	});

	it('never assigns classic precision to an unknown contract asset', async () => {
		const { executor } = fixture([transferRow({ asset_type: '', asset: '' })]);
		expect(
			(await queryHubbleTransferActivity(executor, {}, 70)).transfers[0]!
				.amountScale
		).toBeNull();
	});

	it.each([
		{ minLedger: 1, maxLedger: 1_000_001 },
		{ minLedger: 5, maxLedger: 4 },
		{ amountRaw: '1.5' },
		{ amountRaw: 9007199254740992 },
		{ amountRaw: '170141183460469231731687303715884105728' },
		{ minAmountRaw: '10', maxAmountRaw: '9' },
		{ amountRaw: '2', minAmountRaw: '3' },
		{ startTime: '2026-02-30T00:00:00Z' },
		{ startTime: '2026-09-02T00:00:00Z', endTime: '2026-09-01T00:00:00Z' },
		{ startTime: '2026-09-01' },
		{ limit: 201 },
		{ after: 'not-a-cursor' },
		{ eventTopic: 'payment' },
		{ unknown: 'value' }
	])('rejects invalid inputs without running fact SQL: %j', async (input) => {
		const { executor, requests } = fixture();
		await expect(
			queryHubbleTransferActivity(executor, input as never, 1_000_010)
		).rejects.toBeInstanceOf(HubbleWarehouseInputError);
		expect(requests).toHaveLength(0);
	});

	it('rejects oversized min-only ranges and configured page limits instead of truncating', async () => {
		const { executor } = fixture();
		await expect(
			queryHubbleTransferActivity(executor, { minLedger: 1 }, 1_000_010)
		).rejects.toThrow('split');
		await expect(
			queryHubbleTransferActivity(
				{ ...executor, maximumRows: 10 },
				{ limit: 11 },
				70
			)
		).rejects.toThrow('maximum');
	});
});
