import { fullHistoryLedgerCloseMetaRange as range, fullHistoryLedgerCloseMetaSha256Digest as digest } from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	selectLatestPriorityRange as select,
	TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader as Reader
} from '../TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';

describe('TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader', () => {
	it('uses the actual source head, never a stale canonical watermark', async () => {
		const f = fixture();
		await expect(f.reader.readNextRange(options())).resolves.toEqual(range(64979075, 64987266));
		expect(f.query).toHaveBeenCalledTimes(1);
		expect(f.query.mock.calls[0]?.[0]).not.toMatch(/full_history_watermark|count\(\*\)/);
		expect(f.query.mock.calls[0]?.[1]).toEqual([
			Buffer.from('22'.repeat(32), 'hex'), 64987266 - 17280 + 1, 64987266
		]);
	});

	it('repairs a recent gap outside the old two-batch window', async () => {
		const f = fixture([[3, 10000], [12953, 15000]]);
		await expect(f.reader.readNextRange({
			...options(), durableNextLedger: 10001, latestAvailableLedger: 15000, maximumLedgerCount: 1024
		})).resolves.toEqual(range(11929, 12952));
		expect(f.query.mock.calls[0]?.[1]?.[1]).toBe(3);
	});

	it('newest unregistered source range has priority', async () => {
		const f = fixture([[3, 10000]]);
		await expect(f.reader.readNextRange({
			...options(), latestAvailableLedger: 15000, maximumLedgerCount: 1024
		})).resolves.toEqual(range(13977, 15000));
	});

	it.each([1089, 1090])('requires 64 ledgers in a current tail at head %i', async latestAvailableLedger => {
		const f = fixture([[3, 1026]]);
		await expect(f.reader.readNextRange({
			...options(), latestAvailableLedger, maximumLedgerCount: 1024
		})).resolves.toEqual(latestAvailableLedger === 1090 ? range(1027, 1090) : null);
	});

	it('does not schedule an already registered current window', async () => {
		await expect(fixture([[3, 15000]]).reader.readNextRange({
			...options(), latestAvailableLedger: 15000, maximumLedgerCount: 1024
		})).resolves.toBeNull();
	});

	it('fills newest bounded gaps without overlap or an undersized remainder', () => {
		const bounds = { startSequence: 63379136, endSequence: 63388991 };
		const newest = select(bounds, [], options());
		expect(newest).toEqual(range(63380800, 63388991));
		const previous = select(bounds, [newest!], options());
		expect(previous).toEqual(range(63379136, 63380799));
		expect(select(bounds, [newest!, previous!], options())).toBeNull();
		expect(select({ startSequence: 3, endSequence: 1032 }, [], {
			...options(), maximumLedgerCount: 1024
		})).toEqual(range(67, 1032));
	});

	it('preserves whole source-batch alignment', () => {
		expect(select({ startSequence: 1000, endSequence: 2100 }, [], {
			...options(), maximumLedgerCount: 1024, sourceBatchLedgerCount: 64
		})).toEqual(range(1027, 2050));
	});

	it('historical selection stops before an already committed interval', async () => {
		const f = fixture([[1027, 1090]]);
		await expect(f.reader.readNextHistoricalRange({
			...options(), latestAvailableLedger: 1090, maximumLedgerCount: 1024
		})).resolves.toEqual(range(3, 1026));
	});

	it.each([1028, 1090])('historical lookahead leaves a full minimum before %i', async nextStart => {
		const f = fixture([[nextStart, nextStart + 1023]]);
		const selected = await f.reader.readNextHistoricalRange({
			...options(), latestAvailableLedger: nextStart + 1023, maximumLedgerCount: 1024
		});
		expect(selected?.startSequence).toBe(3);
		expect(nextStart - selected!.endSequence - 1).toBe(64);
		expect(selected!.ledgerCount).toBeGreaterThanOrEqual(64);
	});

	it('fails closed if the durable watermark overlaps a stored batch', async () => {
		await expect(fixture([[3, 100]]).reader.readNextHistoricalRange(options()))
			.rejects.toThrow(/overlaps a committed batch; reload source state/);
	});

	it('fails closed on an unpublished historical interval below the minimum', async () => {
		await expect(fixture([[66, 200]]).reader.readNextHistoricalRange(options()))
			.rejects.toThrow(/below the minimum shard size/);
	});

	it.each([NaN, Infinity, 0, 2, 3.1])('rejects invalid source head %s before querying', async latestAvailableLedger => {
		const f = fixture();
		await expect(f.reader.readNextRange({ ...options(), latestAvailableLedger })).rejects.toThrow(/available range/);
		expect(f.query).not.toHaveBeenCalled();
	});
});

function options() {
	return {
		durableNextLedger: 3, firstAvailableLedger: 3, latestAvailableLedger: 64987266,
		maximumLedgerCount: 8192, networkPassphraseHash: digest('22'.repeat(32)),
		sourceBatchLedgerCount: 1, typedShardLedgerCount: 1024
	};
}

function fixture(ranges: readonly (readonly [number, number])[] = []) {
	const query = jest.fn(async (_sql: string, _parameters?: unknown[]) =>
		ranges.map(([start, end]) => ({ startLedger: String(start), endLedger: String(end) })));
	return { query, reader: new Reader({ query: async <T>(sql: string, parameters?: unknown[]) =>
		await query(sql, parameters) as T }) };
}
