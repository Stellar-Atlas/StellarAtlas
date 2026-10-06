import type { ArchiveBrokerOccupancy } from './ArchiveBrokerConsumerHealth.js';

export interface ArchiveBrokerCapacity {
	readonly availableCapacity: number;
	readonly empty: boolean;
}

export function calculateHistoryArchiveBrokerStreamMessageLimit(
	highWatermark: number
): number {
	return highWatermark * 2;
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
	const refillAt = highWatermark + Math.floor(highWatermark / 2);
	if (occupied > refillAt) return 0;
	return Math.max(
		0,
		calculateHistoryArchiveBrokerStreamMessageLimit(highWatermark) - occupied
	);
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
