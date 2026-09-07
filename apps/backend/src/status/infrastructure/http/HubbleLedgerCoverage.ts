import { HubbleWarehouseUnavailableError } from './HubbleWarehouseErrors.js';
import {
	quoteHubbleIdentifier,
	type HubbleSemanticQueryExecutor
} from './HubbleSemanticWarehouse.js';

export interface HubbleCompletedLedgerRange {
	readonly start_ledger: string | number;
	readonly end_ledger: string | number;
}

export interface HubbleLedgerCoverage {
	/** Disjoint completed intervals at this manifest snapshot, including supplemental imports. */
	readonly completedRanges?: readonly {
		readonly firstLedger: string;
		readonly lastLedger: string;
	}[];
	readonly contiguousFirstLedger: string | null;
	readonly contiguousLastLedger: string | null;
	readonly contiguousLedgerCount: string;
	readonly supplementalLedgerCount: string;
	readonly totalLedgerCount: string;
	readonly nextLedger: string;
	readonly minimumLedger: string | null;
	readonly maximumLedger: string | null;
	readonly gapCount: number;
}

function ledger(value: string | number): number {
	const parsed =
		typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
	if (
		typeof parsed !== 'number' ||
		!Number.isInteger(parsed) ||
		parsed < 1 ||
		parsed > 4294967295
	)
		throw new TypeError('Invalid completed batch ledger bound');
	return parsed;
}

export function summarizeHubbleLedgerCoverage(
	rows: readonly HubbleCompletedLedgerRange[],
	expectedFirstLedger = 2
): HubbleLedgerCoverage {
	const first = ledger(expectedFirstLedger);
	const ranges = rows
		.map((row) => {
			const start = ledger(row.start_ledger),
				end = ledger(row.end_ledger);
			if (end < start)
				throw new TypeError('Reversed completed batch ledger range');
			return { start, end };
		})
		.filter((range) => range.end >= first)
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: { start: number; end: number }[] = [];
	for (const range of ranges) {
		const start = Math.max(first, range.start),
			previous = merged.at(-1);
		if (previous !== undefined && start <= previous.end + 1)
			previous.end = Math.max(previous.end, range.end);
		else merged.push({ start, end: range.end });
	}
	const contiguousEnd = merged[0]?.start === first ? merged[0].end : null;
	const contiguous = contiguousEnd === null ? 0 : contiguousEnd - first + 1;
	const total = merged.reduce(
		(sum, range) => sum + range.end - range.start + 1,
		0
	);
	return {
		completedRanges: merged.map(({ start, end }) => ({
			firstLedger: String(start),
			lastLedger: String(end)
		})),
		contiguousFirstLedger: contiguousEnd === null ? null : String(first),
		contiguousLastLedger: contiguousEnd === null ? null : String(contiguousEnd),
		contiguousLedgerCount: String(contiguous),
		supplementalLedgerCount: String(total - contiguous),
		totalLedgerCount: String(total),
		nextLedger: String(contiguousEnd === null ? first : contiguousEnd + 1),
		minimumLedger: merged.length === 0 ? null : String(merged[0]!.start),
		maximumLedger: merged.length === 0 ? null : String(merged.at(-1)!.end),
		gapCount: Math.max(0, merged.length - (contiguousEnd === null ? 0 : 1))
	};
}

export function isHubbleLedgerWindowComplete(
	coverage: HubbleLedgerCoverage,
	firstLedger: number,
	lastLedger: number
): boolean {
	const first = ledger(firstLedger),
		last = ledger(lastLedger);
	if (last < first) return false;
	// Older callers may have only the contiguous summary. Never infer coverage
	// from the overall min/max bounds: they can span unimported gaps.
	const ranges =
		coverage.completedRanges ??
		(coverage.contiguousFirstLedger !== null &&
		coverage.contiguousLastLedger !== null
			? [
					{
						firstLedger: coverage.contiguousFirstLedger,
						lastLedger: coverage.contiguousLastLedger
					}
				]
			: []);
	return ranges.some(
		(range) =>
			first >= ledger(range.firstLedger) && last <= ledger(range.lastLedger)
	);
}

export async function queryHubbleLedgerCoverage(
	executor: HubbleSemanticQueryExecutor
): Promise<HubbleLedgerCoverage> {
	// Only the small immutable-batch manifest is read, not any warehouse fact table.
	// Filter after latest-state resolution so an earlier completion cannot hide failure.
	// One result row respects the read-only profile's 10,000-row result ceiling.
	// Bound the aggregate allocation and reject truncation instead of hiding gaps.
	const maximumManifestRanges = 100_000;
	const response = await executor.execute<{
		ranges: readonly (readonly [string | number, string | number])[];
		range_count: string | number;
	}>(
		`
SELECT groupArray(${maximumManifestRanges + 1})((tupleElement(latest,2),tupleElement(latest,3))) AS ranges,
 count() AS range_count
FROM (
 SELECT batch_id, argMax(tuple(status,start_ledger,end_ledger),updated_at) AS latest
 FROM ${quoteHubbleIdentifier(executor.database)}._ingestion_batches
 GROUP BY batch_id
)
WHERE tupleElement(latest,1) = 'complete'
FORMAT JSON`,
		[]
	);
	const summary = response.data?.[0];
	const count = Number(summary?.range_count);
	if (
		!Number.isSafeInteger(count) ||
		count < 0 ||
		count > maximumManifestRanges
	)
		throw new HubbleWarehouseUnavailableError(
			'Completed manifest exceeds coverage read bound or is invalid'
		);
	if (
		summary === undefined ||
		!Array.isArray(summary.ranges) ||
		summary.ranges.length !== count
	)
		throw new HubbleWarehouseUnavailableError(
			'Incomplete completed manifest coverage'
		);
	try {
		return summarizeHubbleLedgerCoverage(
			summary.ranges.map(([start_ledger, end_ledger]) => ({
				start_ledger,
				end_ledger
			}))
		);
	} catch {
		throw new HubbleWarehouseUnavailableError(
			'Invalid completed manifest coverage'
		);
	}
}
