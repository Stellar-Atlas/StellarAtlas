export interface FullHistoryLedgerEntryCompactSelection {
	readonly startLedger: number;
	readonly endLedger: number;
}

/** Keep this range in the durable service environment until its retries finish. */
export function parseFullHistoryLedgerEntryCompactSelection(
	environment: NodeJS.ProcessEnv
): FullHistoryLedgerEntryCompactSelection | undefined {
	const start = environment.FULL_HISTORY_LEDGER_CLOSE_META_COMPACT_FIRST_LEDGER;
	const end = environment.FULL_HISTORY_LEDGER_CLOSE_META_COMPACT_LAST_LEDGER;
	if (start === undefined && end === undefined) return undefined;
	if (start === undefined || end === undefined ||
		!/^\d+$/.test(start) || !/^\d+$/.test(end) ||
		start !== String(Number(start)) || end !== String(Number(end))) {
		throw new Error('Compact ledger-entry changes require both first and last ledger');
	}
	const selection = { startLedger: Number(start), endLedger: Number(end) };
	assertCompactSelection(selection);
	return Object.freeze(selection);
}

export function selectsCompactLedgerEntryChanges(
	selection: FullHistoryLedgerEntryCompactSelection | undefined,
	range: FullHistoryLedgerEntryCompactSelection
): boolean {
	if (selection === undefined) return false;
	assertCompactSelection(selection);
	if (range.endLedger < selection.startLedger || range.startLedger > selection.endLedger) {
		return false;
	}
	if (range.startLedger !== selection.startLedger || range.endLedger !== selection.endLedger) {
		throw new Error('Compact ledger-entry changes require the exact configured shard range');
	}
	return true;
}

function assertCompactSelection(selection: FullHistoryLedgerEntryCompactSelection): void {
	if (!Number.isInteger(selection.startLedger) || !Number.isInteger(selection.endLedger) ||
		selection.startLedger < 1 || selection.endLedger > 0xffff_ffff ||
		selection.endLedger < selection.startLedger) {
		throw new RangeError('Compact ledger-entry changes require an ordered uint32 ledger range');
	}
}
