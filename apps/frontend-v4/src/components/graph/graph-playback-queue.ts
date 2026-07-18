import {
	compareLedgerSequences,
	toLedgerSequenceText
} from '../../domain/ledger-sequence';
import type { LedgerPlaybackFrame } from './scp-flow-paths';

interface MergePlaybackQueueOptions {
	activeSlotIndex: string | null;
	boundarySlotIndex: string;
	completedSignatures: ReadonlyMap<string, string>;
	ledgers: readonly LedgerPlaybackFrame[];
	minimumExclusiveSlotIndex: string | null;
}

interface MergePlaybackQueueResult {
	acceptedBoundarySlotIndex: string;
	queue: LedgerPlaybackFrame[];
}

export const maxQueuedPlaybackLedgers = 4;
export const maxToleratedPlaybackLedgerLag = 2n;

export const shouldFastForwardPlayback = (
	activeSlotIndex: string,
	boundarySlotIndex: string | null
): boolean => {
	const active = toLedgerSequenceText(activeSlotIndex);
	const boundary = toLedgerSequenceText(boundarySlotIndex);
	if (active === null || boundary === null) return false;
	return BigInt(boundary) - BigInt(active) > maxToleratedPlaybackLedgerLag;
};

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
	minimumExclusiveSlotIndex
}: MergePlaybackQueueOptions): MergePlaybackQueueResult => {
	const playableLedgers = ledgers
		.filter(
			(ledger) =>
				ledger.statements.length > 0 &&
				compareLedgerSequences(ledger.slotIndex, boundarySlotIndex) < 0 &&
				(minimumExclusiveSlotIndex === null ||
					compareLedgerSequences(ledger.slotIndex, minimumExclusiveSlotIndex) >
						0) &&
				ledger.slotIndex !== activeSlotIndex &&
				!isCompleted(ledger, completedSignatures)
		)
		.toSorted((left, right) =>
			compareLedgerSequences(left.slotIndex, right.slotIndex)
		);
	const boundedQueue = playableLedgers.slice(-maxQueuedPlaybackLedgers);
	const queue =
		activeSlotIndex === null && minimumExclusiveSlotIndex === null
			? boundedQueue.slice(-1)
			: boundedQueue;

	return {
		acceptedBoundarySlotIndex: boundarySlotIndex,
		queue
	};
};
