import { compareLedgerSequences } from '../../domain/ledger-sequence';
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
	const queue = playableLedgers.slice(-maxQueuedPlaybackLedgers);

	return {
		acceptedBoundarySlotIndex: boundarySlotIndex,
		queue
	};
};
