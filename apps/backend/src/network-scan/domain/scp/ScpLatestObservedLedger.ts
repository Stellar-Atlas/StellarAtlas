import type { ScpStatementObservation as CrawlerScpStatementObservation } from 'crawler';
import type {
	ScpLatestObservedLedger,
	ScpStatementWriter
} from './ScpStatementObservationRepository.js';

export function selectLatestObservedScpLedger(
	observations: readonly CrawlerScpStatementObservation[],
	source: ScpStatementWriter
): ScpLatestObservedLedger | null {
	let latest: ScpLatestObservedLedger | null = null;
	for (const observation of observations) {
		if (observation.statementType !== 'externalize') continue;
		if (!/^\d+$/.test(observation.slotIndex)) continue;
		for (const value of observation.values) {
			const closedAt = parseCloseTime(value.closeTime);
			if (closedAt === null) continue;
			const candidate: ScpLatestObservedLedger = {
				closedAt,
				observedAt: observation.observedAt,
				sequence: observation.slotIndex,
				source
			};
			if (latest === null || compareLedger(candidate, latest) > 0) {
				latest = candidate;
			}
		}
	}
	return latest;
}

function compareLedger(
	left: ScpLatestObservedLedger,
	right: ScpLatestObservedLedger
): number {
	const leftSequence = BigInt(left.sequence);
	const rightSequence = BigInt(right.sequence);
	if (leftSequence !== rightSequence) {
		return leftSequence > rightSequence ? 1 : -1;
	}
	const closeTime = left.closedAt.getTime() - right.closedAt.getTime();
	if (closeTime !== 0) return closeTime;
	return left.observedAt.getTime() - right.observedAt.getTime();
}

function parseCloseTime(value: string): Date | null {
	if (!/^\d+$/.test(value)) return null;
	const seconds = Number(value);
	if (!Number.isSafeInteger(seconds) || seconds <= 0) return null;
	const closedAt = new Date(seconds * 1_000);
	return Number.isFinite(closedAt.getTime()) ? closedAt : null;
}
