import {
	fullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaRange
} from '../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

export const FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM = 64;

export function createShardRanges(
	range: FullHistoryLedgerCloseMetaRange,
	ledgersPerBatch: number,
	typedShardLedgerCount: number
): readonly FullHistoryLedgerCloseMetaRange[] {
	if (
		!Number.isSafeInteger(ledgersPerBatch) ||
		ledgersPerBatch < 1 ||
		!Number.isSafeInteger(typedShardLedgerCount) ||
		typedShardLedgerCount < 1 ||
		typedShardLedgerCount % ledgersPerBatch !== 0
	) {
		throw new RangeError('Typed shard must contain whole SEP-54 source batches');
	}
	const minimumShardLedgerCount =
		Math.ceil(
			FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM /
				ledgersPerBatch
		) * ledgersPerBatch;
	if (
		range.ledgerCount < minimumShardLedgerCount ||
		minimumShardLedgerCount > typedShardLedgerCount ||
		range.ledgerCount % ledgersPerBatch !== 0
	) {
		throw new RangeError(
			'LedgerCloseMeta range must contain at least one minimum-sized aligned shard'
		);
	}
	const ranges: FullHistoryLedgerCloseMetaRange[] = [];
	let start: number = range.startSequence;
	let remaining = range.ledgerCount;
	while (remaining > 0) {
		let shardLedgerCount = Math.min(typedShardLedgerCount, remaining);
		const tailLedgerCount = remaining - shardLedgerCount;
		if (tailLedgerCount > 0 && tailLedgerCount < minimumShardLedgerCount) {
			shardLedgerCount -= minimumShardLedgerCount - tailLedgerCount;
		}
		if (
			shardLedgerCount < minimumShardLedgerCount ||
			shardLedgerCount % ledgersPerBatch !== 0
		) {
			throw new RangeError(
				'LedgerCloseMeta range cannot be split into minimum-sized aligned shards'
			);
		}
		ranges.push(
			fullHistoryLedgerCloseMetaRange(
				start,
				start + shardLedgerCount - 1
			)
		);
		start += shardLedgerCount;
		remaining -= shardLedgerCount;
	}
	return ranges;
}
