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
				endSequence: 63_388_991,
				startSequence: 63_380_800
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
				endSequence: 63_388_991,
				ledgerCount: 8_192,
				startSequence: 63_380_800
			})
		);
	});

	it('continues with the next newest whole shard without overlap', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 63_388_991, startSequence: 63_379_136 },
				[{ endSequence: 63_388_991, startSequence: 63_380_800 }],
				options()
			)
		).toEqual(
			expect.objectContaining({
				endSequence: 63_380_799,
				ledgerCount: 1_024,
				startSequence: 63_379_776
			})
		);
	});

	it('leaves a sub-shard remainder for the contiguous historical stream', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 63_388_991, startSequence: 63_379_136 },
				[
					{ endSequence: 63_388_991, startSequence: 63_380_800 },
					{ endSequence: 63_380_799, startSequence: 63_379_776 }
				],
				options()
			)
		).toBeNull();
	});

	it('aligns a selected range to whole source batches', () => {
		expect(
			selectLatestPriorityRange(
				{ endSequence: 2_100, startSequence: 1_000 },
				[],
				{
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
		firstAvailableLedger: 3,
		maximumLedgerCount: 8_192,
		sourceBatchLedgerCount: 1,
		typedShardLedgerCount: 1_024
	};
}
