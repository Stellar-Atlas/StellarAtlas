import type { PublicScpGraphStatement } from '../../api/types';
import { compareLedgerSequences } from '../../domain/ledger-sequence';
import {
	compareStatementsByObservation,
	ledgerCloseAnimationBudgetMs,
	ledgerPlaybackDurationMs,
	selectLedgerAnimationStatements,
	type LedgerPlaybackFrame
} from './scp-flow-paths';

const playbackSlackMs = 300;
const minimumPlaybackDurationMs = 3_000;

const parseTimeMs = (value: string | undefined): number | null => {
	if (value === undefined) return null;
	if (/^\d+$/.test(value)) {
		const parsed = Number(value);
		if (Number.isFinite(parsed))
			return parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
	}
	const time = Date.parse(value);
	return Number.isFinite(time) ? time : null;
};

const getLedgerCloseTimeMs = (
	statements: readonly PublicScpGraphStatement[]
): number | null => {
	const closeTimes = statements
		.map((statement) => parseTimeMs(statement.values[0]?.closeTime))
		.filter((time): time is number => time !== null);
	if (closeTimes.length > 0) return Math.max(...closeTimes);

	const observedTimes = statements
		.map((statement) => parseTimeMs(statement.observedAt))
		.filter((time): time is number => time !== null);
	return observedTimes.length > 0 ? Math.max(...observedTimes) : null;
};

const boundedPlaybackDuration = (
	closeTimeMs: number | null,
	nextCloseTimeMs: number | null
): number => {
	if (closeTimeMs === null || nextCloseTimeMs === null) {
		return ledgerPlaybackDurationMs;
	}

	const closeGapMs = nextCloseTimeMs - closeTimeMs;
	if (!Number.isFinite(closeGapMs) || closeGapMs <= 0)
		return ledgerPlaybackDurationMs;

	return Math.min(
		ledgerPlaybackDurationMs,
		Math.max(minimumPlaybackDurationMs, closeGapMs - playbackSlackMs)
	);
};

export const buildLedgerPlaybackFrames = ({
	boundarySlotIndex,
	latestLedgerClosedAt,
	statements
}: {
	boundarySlotIndex: string;
	latestLedgerClosedAt: string | null;
	statements: readonly PublicScpGraphStatement[];
}): LedgerPlaybackFrame[] => {
	const statementsBySlot = new Map<string, PublicScpGraphStatement[]>();
	for (const statement of statements) {
		statementsBySlot.set(statement.slotIndex, [
			...(statementsBySlot.get(statement.slotIndex) ?? []),
			statement
		]);
	}

	const latestLedgerClosedAtMs = parseTimeMs(latestLedgerClosedAt ?? undefined);
	const ledgerRows = Array.from(statementsBySlot.entries())
		.toSorted(([leftSlot], [rightSlot]) =>
			compareLedgerSequences(leftSlot, rightSlot)
		)
		.map(([slotIndex, slotStatements]) => ({
			closeTimeMs: getLedgerCloseTimeMs(slotStatements),
			slotIndex,
			statements: selectLedgerAnimationStatements(
				slotStatements.toSorted(compareStatementsByObservation)
			)
		}))
		.filter((ledger) => ledger.statements.length > 0);

	const ledgers = ledgerRows.map((ledger, index) => {
		const nextCloseTimeMs =
			ledgerRows[index + 1]?.closeTimeMs ??
			(compareLedgerSequences(ledger.slotIndex, boundarySlotIndex) < 0
				? latestLedgerClosedAtMs
				: null);
		const playbackDurationMs = boundedPlaybackDuration(
			ledger.closeTimeMs,
			nextCloseTimeMs
		);
		return {
			animationBudgetMs: Math.min(
				ledgerCloseAnimationBudgetMs,
				Math.max(1_600, playbackDurationMs - 1_700)
			),
			playbackDurationMs,
			slotIndex: ledger.slotIndex,
			statements: ledger.statements
		};
	});

	const lastLedgerSlotIndex = ledgers.at(-1)?.slotIndex;
	if (
		lastLedgerSlotIndex &&
		compareLedgerSequences(lastLedgerSlotIndex, boundarySlotIndex) < 0
	) {
		return [...ledgers, { slotIndex: boundarySlotIndex, statements: [] }];
	}

	return ledgers;
};
