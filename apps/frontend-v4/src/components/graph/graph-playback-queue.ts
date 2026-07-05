import { compareLedgerSequences } from '../../domain/ledger-sequence';
import type { LedgerPlaybackFrame } from './scp-flow-paths';

interface MergePlaybackQueueOptions {
	activeSlotIndex: string | null;
	boundarySlotIndex: string;
	completedSignatures: ReadonlyMap<string, string>;
	ledgers: readonly LedgerPlaybackFrame[];
	startedThroughSlotIndex: string | null;
}

interface MergePlaybackQueueResult {
	acceptedBoundarySlotIndex: string;
	queue: LedgerPlaybackFrame[];
}

export const getLedgerStatementSignature = (
	ledger: LedgerPlaybackFrame
): string =>
	ledger.statements
		.map((statement) => statement.statementHash)
		.toSorted()
		.join('|');

const isCompleted = (
	ledger: LedgerPlaybackFrame,
	completedSignatures: ReadonlyMap<string, string>
): boolean =>
	completedSignatures.get(ledger.slotIndex) ===
	getLedgerStatementSignature(ledger);

export const mergePlaybackQueue = ({
	activeSlotIndex,
	boundarySlotIndex,
	completedSignatures,
	ledgers,
	startedThroughSlotIndex
}: MergePlaybackQueueOptions): MergePlaybackQueueResult => {
	const latestPlayableLedger = ledgers
		.filter(
			(ledger) =>
				ledger.statements.length > 0 &&
				compareLedgerSequences(ledger.slotIndex, boundarySlotIndex) < 0 &&
				(startedThroughSlotIndex === null ||
					compareLedgerSequences(
						ledger.slotIndex,
						startedThroughSlotIndex
					) > 0) &&
				ledger.slotIndex !== activeSlotIndex
		)
		.toSorted((left, right) =>
			compareLedgerSequences(left.slotIndex, right.slotIndex)
		)
		.at(-1);
	const queue =
		latestPlayableLedger &&
		!isCompleted(latestPlayableLedger, completedSignatures)
			? [latestPlayableLedger]
			: [];

	return {
		acceptedBoundarySlotIndex: boundarySlotIndex,
		queue
	};
};
