import {
	AckPolicy,
	connect,
	DeliverPolicy,
	DiscardPolicy,
	nanos,
	ReplayPolicy,
	RetentionPolicy,
	StorageType,
	type ConsumerInfo,
	type JetStreamClient,
	type JetStreamManager,
	type NatsConnection
} from 'nats';
import type { Logger } from 'logger';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';
import {
	compareHistoryArchiveBrokerJobs,
	HistoryArchiveBrokerFrontierRepository,
	type HistoryArchiveBrokerJob
} from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNotFound(error: unknown): boolean {
	if (!isRecord(error)) return false;
	return error.code === '404' || error.status === 404;
}

function wait(delayMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function assertPublishableBrokerJob(job: HistoryArchiveBrokerJob): void {
	if (job.priority !== 0 && job.priority !== 1 && job.priority !== 2)
		throw new Error('Invalid archive broker publish priority');
	if (!Number.isSafeInteger(job.selectedOrdinal) || job.selectedOrdinal < 1)
		throw new Error('Invalid archive broker selected ordinal');
}

export async function publishHistoryArchiveBrokerJobs(
	jetStream: Pick<JetStreamClient, 'publish'>,
	repository: Pick<HistoryArchiveBrokerFrontierRepository, 'markPublishFailed'>,
	subject: string,
	jobs: readonly HistoryArchiveBrokerJob[]
): Promise<void> {
	for (const job of jobs) assertPublishableBrokerJob(job);
	const ordered = [...jobs].sort(compareHistoryArchiveBrokerJobs);
	let classStart = 0;
	while (classStart < ordered.length) {
		const priority = ordered[classStart]!.priority;
		let classEnd = classStart + 1;
		while (
			classEnd < ordered.length &&
			ordered[classEnd]!.priority === priority
		) {
			classEnd++;
		}
		const priorityClass = ordered.slice(classStart, classEnd);
		const results = await Promise.allSettled(
			priorityClass.map(async (job) => {
				await jetStream.publish(
					subject,
					Buffer.from(
						JSON.stringify({ executionId: job.executionId, job: job.job })
					),
					{ msgID: job.executionId, timeout: 5_000 }
				);
				return job.executionId;
			})
		);
		const failedExecutionIds = results.flatMap((result, index) =>
			result.status === 'rejected' ? [priorityClass[index]!.executionId] : []
		);
		await repository.markPublishFailed(failedExecutionIds);
		const failed = results.find((result) => result.status === 'rejected');
		if (failed?.status === 'rejected') throw failed.reason;
		classStart = classEnd;
	}
}

export async function replayPublishedHistoryArchiveBrokerJobs(
	jetStream: Pick<JetStreamClient, 'publish'>,
	repository: Pick<
		HistoryArchiveBrokerFrontierRepository,
		'findPublishedJobs' | 'markPublishFailed'
	>,
	subject: string,
	highWatermark: number,
	maximumPriority: HistoryArchiveBrokerJob['priority']
): Promise<void> {
	await publishHistoryArchiveBrokerJobs(
		jetStream,
		repository,
		subject,
		await repository.findPublishedJobs(highWatermark, maximumPriority)
	);
}

export class HistoryArchiveBrokerDispatcher {
	private connection: NatsConnection | null = null;
	private jetStream: JetStreamClient | null = null;
	private manager: JetStreamManager | null = null;
	private stopping = false;

	constructor(
		private readonly repository: HistoryArchiveBrokerFrontierRepository,
		private readonly config: HistoryArchiveBrokerConfig,
		private readonly logger: Logger
	) {}

	async run(): Promise<void> {
		await this.initialize();
		while (!this.stopping) {
			try {
				const capacity = await this.getAvailableCapacity();
				if (capacity < 1) {
					await wait(this.config.pollIntervalMs);
					continue;
				}
				let jobs = await this.repository.reserveJobs(
					Math.min(capacity, this.config.batchSize),
					this.config.maximumPerHost,
					this.config.maximumPriority
				);
				if (jobs.length === 0) {
					await this.repository.ensureFrontier();
					jobs = await this.repository.reserveJobs(
						Math.min(capacity, this.config.batchSize),
						this.config.maximumPerHost,
						this.config.maximumPriority
					);
				}
				if (jobs.length === 0) {
					await wait(this.config.pollIntervalMs);
					continue;
				}
				await this.publish(jobs);
			} catch (error) {
				this.logger.error('Archive broker dispatch iteration failed', {
					errorMessage: error instanceof Error ? error.message : String(error)
				});
				await wait(this.config.pollIntervalMs);
			}
		}
	}

	async close(): Promise<void> {
		this.stopping = true;
		const connection = this.connection;
		this.connection = null;
		this.jetStream = null;
		this.manager = null;
		if (connection !== null) await connection.drain();
	}

	private async initialize(): Promise<void> {
		const connection = await connect({
			name: 'stellaratlas-history-archive-dispatcher',
			servers: [...this.config.servers],
			...(this.config.token === undefined ? {} : { token: this.config.token })
		});
		try {
			const jetStream = connection.jetstream();
			const manager = await jetStream.jetstreamManager();
			this.connection = connection;
			this.jetStream = jetStream;
			this.manager = manager;
			await this.ensureStream(manager);
			await this.ensureConsumer(manager);
			await replayPublishedHistoryArchiveBrokerJobs(
				jetStream,
				this.repository,
				this.config.subject,
				this.config.highWatermark,
				this.config.maximumPriority
			);
		} catch (error) {
			this.connection = null;
			this.jetStream = null;
			this.manager = null;
			await connection.close();
			throw error;
		}
	}

	private async ensureStream(manager: JetStreamManager): Promise<boolean> {
		const desired = {
			discard: DiscardPolicy.New,
			duplicate_window: nanos(24 * 60 * 60 * 1_000),
			max_age: 0,
			max_bytes: 64 * 1024 * 1024,
			max_msg_size: 64 * 1024,
			max_msgs: this.config.highWatermark,
			name: this.config.stream,
			num_replicas: 1,
			retention: RetentionPolicy.Workqueue,
			storage: StorageType.File,
			subjects: [this.config.subject]
		};
		try {
			await manager.streams.info(this.config.stream);
			await manager.streams.update(this.config.stream, desired);
			return false;
		} catch (error) {
			if (!isNotFound(error)) throw error;
			await manager.streams.add(desired);
			return true;
		}
	}

	private async ensureConsumer(manager: JetStreamManager): Promise<void> {
		const desired = {
			ack_policy: AckPolicy.Explicit,
			ack_wait: nanos(2 * 60 * 1_000),
			deliver_policy: DeliverPolicy.All,
			durable_name: this.config.consumer,
			filter_subject: this.config.subject,
			max_ack_pending: this.config.highWatermark,
			max_deliver: -1,
			name: this.config.consumer,
			replay_policy: ReplayPolicy.Instant
		};
		try {
			await manager.consumers.info(this.config.stream, this.config.consumer);
			await manager.consumers.update(
				this.config.stream,
				this.config.consumer,
				desired
			);
		} catch (error) {
			if (!isNotFound(error)) throw error;
			await manager.consumers.add(this.config.stream, desired);
		}
	}

	private async getAvailableCapacity(): Promise<number> {
		const manager = this.requireManager();
		const info: ConsumerInfo = await manager.consumers.info(
			this.config.stream,
			this.config.consumer
		);
		const occupied = info.num_ack_pending + info.num_pending;
		return Math.max(0, this.config.highWatermark - occupied);
	}

	private async publish(
		jobs: readonly HistoryArchiveBrokerJob[]
	): Promise<void> {
		await publishHistoryArchiveBrokerJobs(
			this.requireJetStream(),
			this.repository,
			this.config.subject,
			jobs
		);
	}

	private requireJetStream(): JetStreamClient {
		if (this.jetStream === null)
			throw new Error('Archive broker is not initialized');
		return this.jetStream;
	}

	private requireManager(): JetStreamManager {
		if (this.manager === null)
			throw new Error('Archive broker is not initialized');
		return this.manager;
	}
}
