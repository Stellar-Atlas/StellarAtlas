import type { JetStreamManager } from 'nats';
import type { HistoryArchiveBrokerFrontierRepository } from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';
import { calculateHistoryArchiveBrokerStreamMessageLimit } from './ArchiveBrokerBuffer.js';

export async function reconcileSuppressedPublications(
	repository: Pick<
		HistoryArchiveBrokerFrontierRepository,
		'reconcilePhaseSuppressedPublishedJobs'
	>,
	manager: () => JetStreamManager,
	config: Pick<
		HistoryArchiveBrokerConfig,
		'stream' | 'subject' | 'highWatermark'
	>,
	cutoff: Date
): Promise<number> {
	try {
		return await repository.reconcilePhaseSuppressedPublishedJobs(
			cutoff,
			config.highWatermark,
			() =>
				readArchiveBrokerExecutionSnapshot(
					manager(),
					config.stream,
					config.subject,
					calculateHistoryArchiveBrokerStreamMessageLimit(config.highWatermark)
				)
		);
	} catch {
		return 0;
	}
}

export interface ArchiveBrokerExecutionSnapshot {
	readonly executionIds: ReadonlySet<string>;
	confirmUnchanged(): Promise<boolean>;
}

/** Inspect, never consume/delete, the bounded WorkQueue. A concurrent ACK can
 * only make this set conservative. Any new publication, malformed payload,
 * incomplete traversal or unavailable broker makes absence unprovable. */
export async function readArchiveBrokerExecutionSnapshot(
	manager: Pick<JetStreamManager, 'streams'>,
	stream: string,
	subject: string,
	maximumMessages: number
): Promise<ArchiveBrokerExecutionSnapshot | null> {
	const deadline = Date.now() + 1_500;
	async function bounded<T>(work: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				work,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(
						() => reject(new Error('Broker snapshot deadline')),
						Math.max(0, deadline - Date.now())
					);
				})
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
	try {
		const before = await bounded(manager.streams.info(stream));
		if (
			!Number.isSafeInteger(maximumMessages) ||
			maximumMessages < 1 ||
			before.state.messages > maximumMessages ||
			before.config.retention !== 'workqueue' ||
			before.config.subjects?.length !== 1 ||
			before.config.subjects[0] !== subject
		)
			return null;
		const executionIds = new Set<string>();
		let sequence = before.state.first_seq;
		let examined = 0;
		while (sequence <= before.state.last_seq) {
			if (examined >= maximumMessages || Date.now() >= deadline) return null;
			let message;
			try {
				// The deployed server supports next_by_subj; this client's older
				// type surface exposes only seq/last_by_subj. Keep seq typed and
				// send the additive read-only field to skip deleted sequence gaps.
				const request = { next_by_subj: subject, seq: sequence };
				message = await bounded(manager.streams.getMessage(stream, request));
			} catch (error) {
				if ((error as { code?: string }).code === '404') break;
				return null;
			}
			if (message.seq < sequence || message.seq > before.state.last_seq)
				return null;
			const payload: unknown = JSON.parse(
				new TextDecoder().decode(message.data)
			);
			if (
				payload === null ||
				typeof payload !== 'object' ||
				!('executionId' in payload) ||
				typeof payload.executionId !== 'string' ||
				!payload.executionId
			)
				return null;
			executionIds.add(payload.executionId);
			sequence = message.seq + 1;
			examined++;
		}
		const confirmUnchanged = async (): Promise<boolean> => {
			try {
				if (Date.now() >= deadline) return false;
				const current = await bounded(manager.streams.info(stream));
				return (
					current.created === before.created &&
					current.state.last_seq === before.state.last_seq &&
					current.state.messages <= before.state.messages
				);
			} catch {
				return false;
			}
		};
		return (await confirmUnchanged())
			? { executionIds, confirmUnchanged }
			: null;
	} catch {
		return null;
	}
}
