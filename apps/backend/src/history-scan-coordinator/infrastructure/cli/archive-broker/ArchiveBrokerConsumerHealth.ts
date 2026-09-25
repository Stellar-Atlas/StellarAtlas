import type { Logger } from 'logger';

interface ConsumerPosition {
	readonly num_ack_pending: number;
	readonly num_pending: number;
	readonly delivered: { readonly stream_seq: number };
}

interface StreamPosition {
	readonly state: { readonly messages: number; readonly last_seq: number };
}

export interface ArchiveBrokerOccupancy {
	readonly consumer: ConsumerPosition;
	readonly stream: StreamPosition;
	readonly inconsistent: boolean;
}

// The normal path still makes exactly the same two parallel metadata requests.
// Confirm a suspicious snapshot after the consumer read: concurrent publication
// may otherwise make a healthy consumer look newer than the first stream read.
export async function readArchiveBrokerOccupancy(
	readConsumer: () => Promise<ConsumerPosition>,
	readStream: () => Promise<StreamPosition>
): Promise<ArchiveBrokerOccupancy> {
	const [consumer, initialStream] = await Promise.all([
		readConsumer(),
		readStream()
	]);
	const stream =
		consumer.delivered.stream_seq > initialStream.state.last_seq
			? await readStream()
			: initialStream;
	return {
		consumer,
		stream,
		inconsistent: consumer.delivered.stream_seq > stream.state.last_seq
	};
}

// Diagnostics only; never delete/recreate a durable consumer automatically,
// ignore its occupancy, raise its capacity, or write per-job database state.
export function createArchiveBrokerConsumerStateReporter(
	logger: Pick<Logger, 'error' | 'info'>,
	now: () => number = Date.now
): (occupancy: ArchiveBrokerOccupancy) => void {
	let nextReportAt = 0;
	let unhealthy = false;
	return (occupancy) => {
		if (!occupancy.inconsistent) {
			if (unhealthy)
				logger.info('Archive broker consumer position is consistent again');
			unhealthy = false;
			nextReportAt = 0;
			return;
		}
		unhealthy = true;
		const time = now();
		if (time < nextReportAt) return;
		nextReportAt = time + 60_000;
		logger.error('Archive broker consumer position exceeds its stream', {
			consumerDeliveredSequence: occupancy.consumer.delivered.stream_seq,
			streamLastSequence: occupancy.stream.state.last_seq,
			unacknowledgedJobs: occupancy.consumer.num_ack_pending,
			streamMessages: occupancy.stream.state.messages,
			action:
				'Inspect durable consumer recovery; preserve stream and database evidence'
		});
	};
}
