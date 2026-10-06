import type { ArchiveBrokerOccupancy } from './ArchiveBrokerConsumerHealth.js';

export interface ArchiveBrokerCapacity {
	readonly availableCapacity: number;
	readonly empty: boolean;
}

/** W remains verification concurrency. A completed delivery may retain its ACK
 * while one bounded terminal queue (also W) persists evidence. Both share the
 * existing 2W durable stream budget; this does not grant more download slots. */
export function getHistoryArchiveBrokerWorkBudget(highWatermark: number): {
	readonly activeVerifications: number;
	readonly pendingTerminals: number;
	readonly maximumUnacknowledged: number;
	readonly maximumMessages: number;
	readonly refillAt: number;
} {
	return {
		activeVerifications: highWatermark,
		pendingTerminals: highWatermark,
		maximumUnacknowledged: highWatermark * 2,
		maximumMessages: highWatermark * 2,
		refillAt: highWatermark + Math.floor(highWatermark / 2)
	};
}

export function calculateHistoryArchiveBrokerStreamMessageLimit(
	highWatermark: number
): number {
	return getHistoryArchiveBrokerWorkBudget(highWatermark).maximumMessages;
}

export function calculateHistoryArchiveBrokerAvailableCapacity(
	highWatermark: number,
	numAckPending: number,
	numPending: number,
	numStreamMessages: number
): number {
	if (
		!Number.isSafeInteger(highWatermark) ||
		highWatermark < 1 ||
		![numAckPending, numPending, numStreamMessages].every(
			(value) => Number.isSafeInteger(value) && value >= 0
		)
	)
		return 0;
	// Retained messages and consumer occupancy may differ; never ignore either.
	const occupied = Math.max(numAckPending + numPending, numStreamMessages);
	const budget = getHistoryArchiveBrokerWorkBudget(highWatermark);
	if (occupied > budget.refillAt) return 0;
	return Math.max(0, budget.maximumMessages - occupied);
}

export function getArchiveBrokerCapacity(
	highWatermark: number,
	occupancy: ArchiveBrokerOccupancy
): ArchiveBrokerCapacity {
	if (occupancy.inconsistent) return { availableCapacity: 0, empty: false };
	const ack = occupancy.consumer.num_ack_pending;
	const pending = occupancy.consumer.num_pending;
	const messages = occupancy.stream.state.messages;
	return {
		availableCapacity: calculateHistoryArchiveBrokerAvailableCapacity(
			highWatermark,
			ack,
			pending,
			messages
		),
		// Capacity is NOT emptiness: with a prebuffer, W active jobs has W capacity.
		empty: ack === 0 && pending === 0 && messages === 0
	};
}
