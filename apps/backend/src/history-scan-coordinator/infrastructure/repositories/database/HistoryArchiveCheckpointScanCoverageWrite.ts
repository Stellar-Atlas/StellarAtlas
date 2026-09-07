import type { EntityManager } from 'typeorm';
import { historyArchiveCheckpointScanCoverageSql } from './HistoryArchiveCheckpointScanCoverageSql.js';

export interface HistoryArchiveCheckpointScanPosition {
	readonly archiveUrlIdentity: string;
	readonly checkpointLedger: number;
}
export interface HistoryArchiveCheckpointScanRange {
	readonly archiveUrlIdentity: string;
	readonly firstCheckpointLedger: number;
	readonly lastCheckpointLedger: number;
}
export interface HistoryArchiveCheckpointScanTerminalRow {
	readonly archiveUrlIdentity: string;
	readonly objectType: string;
	readonly checkpointLedger: number | null;
}

const checkpointCategories = new Set([
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp'
]);

/** One call per evidence transaction, using only fenced terminal rows and accepted listing ranges. */
export async function recordAcceptedHistoryArchiveCheckpointScans(
	manager: EntityManager,
	rows: readonly HistoryArchiveCheckpointScanTerminalRow[],
	ranges: readonly HistoryArchiveCheckpointScanRange[] = []
): Promise<number> {
	return applyCoverage(
		manager,
		rows.flatMap((row) =>
			checkpointCategories.has(row.objectType) &&
			validCheckpoint(row.checkpointLedger)
				? [
						{
							archiveUrlIdentity: row.archiveUrlIdentity,
							checkpointLedger: row.checkpointLedger!
						}
					]
				: []
		),
		ranges
	);
}

export async function applyHistoryArchiveCheckpointScanPositions(
	manager: EntityManager,
	positions: readonly HistoryArchiveCheckpointScanPosition[]
): Promise<number> {
	return applyCoverage(manager, positions, []);
}

/** Listing inputs have already passed provider, exact-root and full-range validation. */
export async function applyHistoryArchiveCheckpointScanRanges(
	manager: EntityManager,
	ranges: readonly HistoryArchiveCheckpointScanRange[]
): Promise<number> {
	return applyCoverage(manager, [], ranges);
}

async function applyCoverage(
	manager: EntityManager,
	positions: readonly HistoryArchiveCheckpointScanPosition[],
	ranges: readonly HistoryArchiveCheckpointScanRange[]
): Promise<number> {
	for (const position of positions) {
		if (
			!validRoot(position.archiveUrlIdentity) ||
			!validCheckpoint(position.checkpointLedger)
		)
			throw new Error('Invalid checkpoint scan position');
	}
	for (const range of ranges) {
		if (
			!validRoot(range.archiveUrlIdentity) ||
			!validCheckpoint(range.firstCheckpointLedger) ||
			!validCheckpoint(range.lastCheckpointLedger) ||
			range.lastCheckpointLedger < range.firstCheckpointLedger
		)
			throw new Error('Invalid checkpoint listing scan range');
	}
	if (positions.length === 0 && ranges.length === 0) return 0;
	if (manager.queryRunner?.isTransactionActive !== true)
		throw new Error(
			'Checkpoint scan coverage requires the evidence transaction'
		);
	const rows = (await manager.query(historyArchiveCheckpointScanCoverageSql, [
		JSON.stringify(positions),
		JSON.stringify(ranges)
	])) as readonly { readonly changedPages: number }[];
	const count = rows[0]?.changedPages;
	if (!Number.isSafeInteger(count) || count === undefined || count < 0)
		throw new Error('Invalid checkpoint scan coverage write receipt');
	return count;
}

function validCheckpoint(value: number | null): boolean {
	return (
		value !== null &&
		Number.isSafeInteger(value) &&
		value >= 63 &&
		value <= 2_147_483_647 &&
		value % 64 === 63
	);
}

function validRoot(value: string): boolean {
	return (
		typeof value === 'string' && value.length > 0 && value.trim() === value
	);
}
