import type { DataSource } from 'typeorm';
import {
	fullHistoryLedgerCloseMetaRange,
	fullHistoryLedgerCloseMetaSha256Digest,
	type FullHistoryLedgerCloseMetaRange,
	type FullHistoryLedgerCloseMetaSha256Digest
} from '../../../domain/full-history-ledger-close-meta/FullHistoryLedgerCloseMetaBatch.js';

interface CanonicalRangeRow {
	readonly nextLedger: string;
	readonly startLedger: string;
}

interface StoredRangeRow {
	readonly endLedger: string;
	readonly startLedger: string;
}

interface LedgerRangeBounds {
	readonly endSequence: number;
	readonly startSequence: number;
}

export interface FullHistoryLedgerCloseMetaPriorityRangeOptions {
	readonly firstAvailableLedger: number;
	readonly maximumLedgerCount: number;
	readonly networkPassphraseHash: FullHistoryLedgerCloseMetaSha256Digest;
	readonly sourceBatchLedgerCount: number;
	readonly typedShardLedgerCount: number;
}

export class TypeOrmFullHistoryLedgerCloseMetaPriorityRangeReader {
	constructor(private readonly dataSource: Pick<DataSource, 'query'>) {}

	async readNextRange(
		options: FullHistoryLedgerCloseMetaPriorityRangeOptions
	): Promise<FullHistoryLedgerCloseMetaRange | null> {
		validateOptions(options);
		const networkHash = Buffer.from(
			fullHistoryLedgerCloseMetaSha256Digest(options.networkPassphraseHash),
			'hex'
		);
		const canonicalRows = await this.dataSource.query<CanonicalRangeRow[]>(
			`select "first_ledger"::text as "startLedger",
				"next_ledger"::text as "nextLedger"
			 from "full_history_watermark"
			 where "network_passphrase_hash" = $1`,
			[networkHash]
		);
		if (canonicalRows.length === 0) return null;
		const canonical = exactlyOne(canonicalRows, 'canonical watermark');
		const minimumLedger = databaseInteger(
			canonical.startLedger,
			'minimum canonical ledger'
		);
		const nextLedger = databaseInteger(
			canonical.nextLedger,
			'next canonical ledger'
		);
		if (nextLedger <= minimumLedger) {
			throw new Error('Canonical full-history watermark is empty or invalid');
		}
		const maximumLedger = nextLedger - 1;
		const searchMinimum = Math.max(
			minimumLedger,
			maximumLedger - options.maximumLedgerCount * 2 + 1
		);
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
	canonical: LedgerRangeBounds,
	storedRanges: readonly LedgerRangeBounds[],
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash'
	>
): FullHistoryLedgerCloseMetaRange | null {
	validateRangeBounds(canonical, 'canonical range');
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
	let cursor = canonical.endSequence;
	for (const range of ranges) {
		if (range.startSequence > cursor) continue;
		if (range.endSequence < canonical.startSequence) break;
		if (range.endSequence < cursor) {
			const candidate = latestWholeShardInGap(
				Math.max(canonical.startSequence, range.endSequence + 1),
				cursor,
				options
			);
			if (candidate !== null) return candidate;
		}
		cursor = Math.min(cursor, range.startSequence - 1);
		if (cursor < canonical.startSequence) return null;
	}
	return latestWholeShardInGap(canonical.startSequence, cursor, options);
}

function latestWholeShardInGap(
	startLedger: number,
	endLedger: number,
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash'
	>
): FullHistoryLedgerCloseMetaRange | null {
	if (endLedger < startLedger) return null;
	const alignmentRemainder = positiveModulo(
		endLedger - options.firstAvailableLedger + 1,
		options.sourceBatchLedgerCount
	);
	const alignedEnd = endLedger - alignmentRemainder;
	if (alignedEnd < startLedger) return null;
	const availableLedgers = alignedEnd - startLedger + 1;
	const ledgerCount =
		Math.floor(
			Math.min(availableLedgers, options.maximumLedgerCount) /
				options.typedShardLedgerCount
		) * options.typedShardLedgerCount;
	if (ledgerCount < options.typedShardLedgerCount) return null;
	return fullHistoryLedgerCloseMetaRange(
		alignedEnd - ledgerCount + 1,
		alignedEnd
	);
}

function validateOptions(
	options: FullHistoryLedgerCloseMetaPriorityRangeOptions
): void {
	fullHistoryLedgerCloseMetaSha256Digest(options.networkPassphraseHash);
	validatePlanningOptions(options);
}

function validatePlanningOptions(
	options: Omit<
		FullHistoryLedgerCloseMetaPriorityRangeOptions,
		'networkPassphraseHash'
	>
): void {
	const values = [
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

function exactlyOne<T>(rows: readonly T[], label: string): T {
	if (rows.length !== 1) throw new Error(`Expected one ${label}`);
	return rows[0]!;
}
