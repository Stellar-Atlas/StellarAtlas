import { compareLedgerSequences } from '../../domain/ledger-sequence';
import type { LedgerPlaybackFrame } from './scp-flow-paths';

interface MergePlaybackQueueOptions {
	activeSlotIndex: string | null;
	boundarySlotIndex: string;
	completedSignatures: ReadonlyMap<string, string>;
	currentQueue: readonly LedgerPlaybackFrame[];
	ledgers: readonly LedgerPlaybackFrame[];
}

interface MergePlaybackQueueResult {
	acceptedBoundarySlotIndex: string;
	queue: LedgerPlaybackFrame[];
}

const maxQueuedPlaybackLedgers = 12;

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

const isQueued = (
	queue: readonly LedgerPlaybackFrame[],
	slotIndex: string
): boolean => queue.some((ledger) => ledger.slotIndex === slotIndex);

export const mergePlaybackQueue = ({
	activeSlotIndex,
	boundarySlotIndex,
	completedSignatures,
	currentQueue,
	ledgers
}: MergePlaybackQueueOptions): MergePlaybackQueueResult => {
	const playableLedgers = ledgers
		.filter(
			(ledger) =>
				ledger.statements.length > 0 &&
				compareLedgerSequences(ledger.slotIndex, boundarySlotIndex) < 0 &&
				ledger.slotIndex !== activeSlotIndex &&
				!isCompleted(ledger, completedSignatures)
		)
		.toSorted((left, right) =>
			compareLedgerSequences(left.slotIndex, right.slotIndex)
		);
	const retainedQueue = currentQueue.filter(
		(ledger) =>
			ledger.slotIndex !== activeSlotIndex &&
			!isCompleted(ledger, completedSignatures)
	);
	const queue = [...retainedQueue];
	for (const candidate of playableLedgers) {
		if (!isQueued(queue, candidate.slotIndex)) queue.push(candidate);
	}

	return {
		acceptedBoundarySlotIndex: boundarySlotIndex,
		queue: queue
			.toSorted((left, right) =>
				compareLedgerSequences(left.slotIndex, right.slotIndex)
			)
			.slice(-maxQueuedPlaybackLedgers)
	};
};
