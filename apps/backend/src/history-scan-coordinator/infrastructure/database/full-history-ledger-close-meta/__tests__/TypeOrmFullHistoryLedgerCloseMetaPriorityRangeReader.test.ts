import type { DataSource } from 'typeorm';
import { fullHistoryLedgerCloseMetaSha256Digest } from '../../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';
import {
	selectLatestPriorityRange,
	TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader
} from '../TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader.js';

describe('selectLatestPriorityRange', () => {
	it('reads a canonical range without treating its digest as numeric config', async () => {
		const query = jest
			.fn()
			.mockResolvedValueOnce([
				{
					nextLedger: '63388992',
					startLedger: '63379136'
				}
			])
			.mockResolvedValueOnce([]);
		const reader = new TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader({
			query
		} as unknown as Pick<DataSource, 'query'>);

		await expect(
			reader.readNextRange({
				...options(),
				networkPassphraseHash: fullHistoryLedgerCloseMetaSha256Digest(
					'22'.repeat(32)
				)
			})
		).resolves.toEqual(
			expect.objectContaining({
				endSequence: 63_388_674,
				startSequence: 63_380_483
			})
		);
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0]?.[0]).toContain('full_history_watermark');
		expect(query.mock.calls[0]?.[0]).not.toContain('count(*)');
	});

	it('returns no priority work before canonical promotion exists', async () => {
		const query = jest.fn().mockResolvedValueOnce([]);
		const reader = new TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader({
			query
		} as unknown as Pick<DataSource, 'query'>);

		await expect(
			reader.readNextRange({
				...options(),
				networkPassphraseHash: fullHistoryLedgerCloseMetaSha256Digest(
					'22'.repeat(32)
				)
			})
		).resolves.toBeNull();
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('selects the newest whole bounded shard inside canonical history', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 63_388_991, startSequence: 63_379_136 },
				[],
				options()
			)
		).toEqual(
			expect.objectContaining({
				endSequence: 63_388_674,
				ledgerCount: 8_192,
				startSequence: 63_380_483
			})
		);
	});

	it('continues with the next newest whole shard without overlap', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 63_388_991, startSequence: 63_379_136 },
				[{ endSequence: 63_388_674, startSequence: 63_380_483 }],
				options()
			)
		).toEqual(
			expect.objectContaining({
				endSequence: 63_380_482,
				ledgerCount: 1_024,
				startSequence: 63_379_459
			})
		);
	});

	it('leaves a sub-shard remainder for the contiguous historical stream', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 63_388_991, startSequence: 63_379_136 },
				[
					{ endSequence: 63_388_674, startSequence: 63_380_483 },
					{ endSequence: 63_380_482, startSequence: 63_379_459 }
				],
				options()
			)
		).toBeNull();
	});

	it('aligns near-tip shards to the durable historical watermark lattice', () => {
		const durableNextLedger = 131;
		const newestRange = selectLatestPriorityRange(
			{ endSequence: 63_389_311, startSequence: 63_378_688 },
			[],
			{ ...options(), durableNextLedger }
		);

		expect(newestRange).toEqual(
			expect.objectContaining({
				endSequence: 63_388_802,
				ledgerCount: 8_192,
				startSequence: 63_380_611
			})
		);

		const nextRange = selectLatestPriorityRange(
			{ endSequence: 63_389_311, startSequence: 63_378_688 },
			[{ endSequence: 63_388_802, startSequence: 63_380_611 }],
			{ ...options(), durableNextLedger }
		);
		expect(nextRange).toEqual(
			expect.objectContaining({
				endSequence: 63_380_610,
				ledgerCount: 1_024,
				startSequence: 63_379_587
			})
		);

		const precedingHistoricalShardEnd =
			durableNextLedger +
			Math.floor(
				(nextRange!.startSequence - durableNextLedger) /
					options().typedShardLedgerCount
			) *
				options().typedShardLedgerCount -
			1;
		expect(precedingHistoricalShardEnd).toBe(nextRange!.startSequence - 1);
	});

	it('aligns a selected range to whole source batches', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 2_100, startSequence: 1_000 },
				[],
				{
					durableNextLedger: 3,
					firstAvailableLedger: 3,
					maximumLedgerCount: 1_024,
					sourceBatchLedgerCount: 64,
					typedShardLedgerCount: 1_024
				}
			)
		).toEqual(
			expect.objectContaining({
				endSequence: 2_050,
				ledgerCount: 1_024,
				startSequence: 1_027
			})
		);
	});
});

function options() {
	return {
		durableNextLedger: 3,
		firstAvailableLedger: 3,
		maximumLedgerCount: 8_192,
		sourceBatchLedgerCount: 1,
		typedShardLedgerCount: 1_024
	};
}
