import type { DataSource } from 'typeorm';
import { FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM } from '../../../use-cases/ingest-full-history-ledger-close-meta/FullHistoryLedgerCloseMetaShardRanges.js';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

interface StoredRangeRow {
	readonly endLedger: string;
	readonly startLedger: string;
}

interface LedgerRangeBounds {
	readonly endSequence: number;
	readonly startSequence: number;
}

export interface FullHistoryLedgerCloseMetaPriorityRangeOptions {
	readonly minimumPriorityLedger?: number;
	readonly durableNextLedger: number;
	readonly firstAvailableLedger: number;
	readonly latestAvailableLedger: number;
	readonly maximumLedgerCount: number;
	readonly networkPassphraseHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly sourceBatchLedgerCount: number;
	readonly typedShardLedgerCount: number;
}

export class TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader {
	constructor(private readonly dataSource: Pick<DataSource, 'query'>) {}

	async readNextHistoricalRange(
		options: FullHistoryLedgerCloseMetaPriorityRangeOptions
	): Promise<FullHistoryLedgerCloseMetaRange | null> {
		validateOptions(options);
		const start = options.durableNextLedger;
		const maximumEnd = Math.min(
			options.latestAvailableLedger,
			start + options.maximumLedgerCount - 1
		);
		if (maximumEnd < start) return null;
		const minimum = minimumShardLedgerCount(options);
		const lookaheadEnd = Math.min(options.latestAvailableLedger, maximumEnd + minimum);
		const rows = await this.dataSource.query<StoredRangeRow[]>(
			`(select "start_ledger"::text as "startLedger",
				"end_ledger"::text as "endLedger"
			 from "full_history_ledger_close_meta_batch"
			 where "network_passphrase_hash" = $1
				and "start_ledger" <= $2
			 order by "start_ledger" desc limit 1)
			 union all
			 (select "start_ledger"::text as "startLedger",
				"end_ledger"::text as "endLedger"
			 from "full_history_ledger_close_meta_batch"
			 where "network_passphrase_hash" = $1
				and "start_ledger" > $2 and "start_ledger" <= $3
			 order by "start_ledger" asc limit 1)`,
			[Buffer.from(options.networkPassphraseHash, 'hex'), start, lookaheadEnd]
		);
		const next = rows.filter(row => databaseInteger(row.endLedger, 'stored range end') >= start)
			.sort((left, right) => Number(left.startLedger) - Number(right.startLedger))[0];
		const nextStart = next === undefined
			? null : databaseInteger(next.startLedger, 'stored range start');
		if (nextStart !== null && nextStart <= start) {
			throw new Error('Durable watermark overlaps a committed batch; reload source state');
		}
		const end = Math.min(maximumEnd, nextStart === null ? maximumEnd : nextStart - 1);
		let count = Math.floor((end - start + 1) / options.sourceBatchLedgerCount) *
			options.sourceBatchLedgerCount;
		const remainder = nextStart === null ? 0 : nextStart - start - count;
		if (remainder > 0 && remainder < minimum) count -= minimum - remainder;
		if (count < minimum) {
			if (nextStart !== null) {
				throw new Error('Unpublished interval before a committed batch is below the minimum shard size');
			}
			return null;
		}
		return fullHistoryLedgerCloseMetaRange(start, start + count - 1);
	}

	async readNextRange(
		options: FullHistoryLedgerCloseMetaPriorityRangeOptions
	): Promise<FullHistoryLedgerCloseMetaRange | null> {
		validateOptions(options);
		const networkHash = Buffer.from(
			fullHistoryLedgerCloseMetaSha256Digest(options.networkPassphraseHash),
			'hex'
		);
		const maximumLedger = options.latestAvailableLedger;
		const searchMinimum = Math.max(
			options.firstAvailableLedger,
			options.minimumPriorityLedger ?? options.firstAvailableLedger,
			maximumLedger - Math.max(options.maximumLedgerCount * 2, 17_280) + 1
		);
		if (searchMinimum > maximumLedger) return null;
		const storedRows = await this.dataSource.query<StoredRangeRow[]>(
			`select "start_ledger"::text as "startLedger",
				"end_ledger"::text as "endLedger"
			 from "full_history_ledger_close_meta_batch"
			 where "network_passphrase_hash" = $1
				and "end_ledger" >= $2 and "start_ledger" <= $3
			 order by "end_ledger" desc, "start_ledger" desc`,
			[networkHash, searchMinimum, maximumLedger]
		);
		return selectLatestPriorityRange(
			{ endSequence: maximumLedger, startSequence: searchMinimum },
			storedRows.map((row) => ({
				endSequence: databaseInteger(row.endLedger, 'stored range end'),
				startSequence: databaseInteger(row.startLedger, 'stored range start')
			})),
			options
		);
	}
}

export function selectLatestPriorityRange(
	availableRange: LedgerRangeBounds,
	storedRanges: readonly LedgerRangeBounds[],
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash' | 'latestAvailableLedger'
	>
): FullHistoryLedgerCloseMetaRange | null {
	validateRangeBounds(availableRange, 'available range');
	validatePlanningOptions(options);
	const ranges = storedRanges
		.map((range) => {
			validateRangeBounds(range, 'stored range');
			return range;
		})
		.sort(
			(left, right) =>
				right.endSequence - left.endSequence ||
				right.startSequence - left.startSequence
		);
	let cursor = availableRange.endSequence;
	for (const range of ranges) {
		if (range.startSequence > cursor) continue;
		if (range.endSequence < availableRange.startSequence) break;
		if (range.endSequence < cursor) {
			const candidate = latestWholeSourceRangeInGap(
				Math.max(availableRange.startSequence, range.endSequence + 1),
				cursor,
				options
			);
			if (candidate !== null) return candidate;
		}
		cursor = Math.min(cursor, range.startSequence - 1);
		if (cursor < availableRange.startSequence) return null;
	}
	return latestWholeSourceRangeInGap(availableRange.startSequence, cursor, options);
}

function latestWholeSourceRangeInGap(
	startLedger: number,
	endLedger: number,
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash' | 'latestAvailableLedger'
	>
): FullHistoryLedgerCloseMetaRange | null {
	if (endLedger < startLedger) return null;
	const alignmentRemainder = positiveModulo(
		endLedger + 1 - options.firstAvailableLedger,
		options.sourceBatchLedgerCount
	);
	const alignedEnd = endLedger - alignmentRemainder;
	const alignedStart = startLedger + positiveModulo(
		options.firstAvailableLedger - startLedger,
		options.sourceBatchLedgerCount
	);
	if (alignedEnd < alignedStart) return null;
	const availableLedgers = alignedEnd - alignedStart + 1;
	const minimum = minimumShardLedgerCount(options);
	let ledgerCount =
		Math.floor(
			Math.min(availableLedgers, options.maximumLedgerCount) /
				options.sourceBatchLedgerCount
		) * options.sourceBatchLedgerCount;
	const remainder = availableLedgers - ledgerCount;
	if (remainder > 0 && remainder < minimum) {
		ledgerCount -= minimum - remainder;
	}
	if (ledgerCount < minimum) return null;
	return fullHistoryLedgerCloseMetaRange(
		alignedEnd - ledgerCount + 1,
		alignedEnd
	);
}

function minimumShardLedgerCount(options: Pick<FullHistoryLedgerCloseMetaPriorityRangeOptions,
	'sourceBatchLedgerCount' | 'typedShardLedgerCount'>): number {
	return Math.ceil(Math.min(FULL_HISTORY_LEDGER_CLOSE_META_TYPED_SHARD_LEDGER_MINIMUM,
		options.typedShardLedgerCount) / options.sourceBatchLedgerCount) * options.sourceBatchLedgerCount;
}

function validateOptions(
	options: FullHistoryLedgerCloseMetaPriorityRangeOptions
): void {
	fullHistoryLedgerCloseMetaSha256Digest(options.networkPassphraseHash);
	validatePlanningOptions(options);
	validateRangeBounds(
		{
			endSequence: options.latestAvailableLedger,
			startSequence: options.firstAvailableLedger
		},
		'available range'
	);
}

function validatePlanningOptions(
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash' | 'latestAvailableLedger'
	>
): void {
	if (options.minimumPriorityLedger !== undefined &&
		(!Number.isSafeInteger(options.minimumPriorityLedger) || options.minimumPriorityLedger < 1 ||
			options.minimumPriorityLedger > 0xffff_ffff)) {
		throw new RangeError('minimumPriorityLedger must be a positive uint32');
	}
	const values = [
		['durableNextLedger', options.durableNextLedger],
		['firstAvailableLedger', options.firstAvailableLedger],
		['maximumLedgerCount', options.maximumLedgerCount],
		['sourceBatchLedgerCount', options.sourceBatchLedgerCount],
		['typedShardLedgerCount', options.typedShardLedgerCount]
	] as const;
	for (const [field, value] of values) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new RangeError(`${field} must be a positive integer`);
		}
	}
	if (
		options.maximumLedgerCount % options.typedShardLedgerCount !== 0 ||
		options.typedShardLedgerCount % options.sourceBatchLedgerCount !== 0
	) {
		throw new RangeError(
			'Priority range sizes must contain whole source batches'
		);
	}
	if (
		options.durableNextLedger < options.firstAvailableLedger ||
		positiveModulo(
			options.durableNextLedger - options.firstAvailableLedger,
			options.sourceBatchLedgerCount
		) !== 0
	) {
		throw new RangeError(
			'Durable next ledger must align to the source batch lattice'
		);
	}
}

function validateRangeBounds(
	range: { readonly endSequence: number; readonly startSequence: number },
	label: string
): void {
	if (
		!Number.isSafeInteger(range.startSequence) ||
		!Number.isSafeInteger(range.endSequence) ||
		range.startSequence < 1 ||
		range.endSequence < range.startSequence
	) {
		throw new RangeError(`${label} is invalid`);
	}
}

function positiveModulo(value: number, divisor: number): number {
	return ((value % divisor) + divisor) % divisor;
}

function databaseInteger(value: string, field: string): number {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(`Invalid database ${field}`);
	}
	return parsed;
}
