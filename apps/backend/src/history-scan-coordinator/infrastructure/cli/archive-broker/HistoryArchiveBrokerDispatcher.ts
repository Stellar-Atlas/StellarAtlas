import { createRequire } from 'node:module';
import {
	AckPolicy,
	connect,
	DeliverPolicy,
	DiscardPolicy,
	nanos,
	ReplayPolicy,
	RetentionPolicy,
	StorageType,
	type JetStreamClient,
	type JetStreamManager,
	type NatsConnection,
	type Subscription
} from 'nats';
import type { Logger } from 'logger';
import type { HistoryArchiveBrokerConfig } from './HistoryArchiveBrokerConfig.js';
import {
	ArchiveBrokerFrontierMaintenance,
	archiveBrokerFrontierMaintenanceIntervalMs as orphanedPublishedReplayIntervalMs
} from './ArchiveBrokerFrontierMaintenance.js';
import { reconcileSuppressedPublications } from './ArchiveBrokerExecutionSnapshot.js';
import { ArchiveBrokerAdaptiveMaintenance } from './ArchiveBrokerAdaptiveMaintenance.js';
import {
	compareHistoryArchiveBrokerJobs,
	HistoryArchiveBrokerFrontierRepository,
	type HistoryArchiveBrokerJob
} from '../../repositories/database/HistoryArchiveBrokerFrontierRepository.js';
import { historyArchiveReadyNotificationChannel } from '../../repositories/database/HistoryArchiveObjectReadyQueue.js';
import {
	createArchiveBrokerConsumerStateReporter,
	readArchiveBrokerOccupancy
} from './ArchiveBrokerConsumerHealth.js';
import {
	calculateHistoryArchiveBrokerStreamMessageLimit,
	getArchiveBrokerCapacity,
	type ArchiveBrokerCapacity
} from './ArchiveBrokerBuffer.js';
export {
	calculateHistoryArchiveBrokerAvailableCapacity,
	calculateHistoryArchiveBrokerStreamMessageLimit
} from './ArchiveBrokerBuffer.js';

interface PostgresNotification {
	readonly channel: string;
}
interface PostgresNotificationClient {
	connect(): Promise<void>;
	end(): Promise<void>;
	on(
		event: 'notification',
		listener: (notification: PostgresNotification) => void
	): this;
	on(event: 'error', listener: (error: Error) => void): this;
	query(sql: string): Promise<unknown>;
}
const { Client: PostgresClient } = createRequire(import.meta.url)('pg') as {
	Client: new (config: {
		readonly connectionString: string;
	}) => PostgresNotificationClient;
};
const orphanedPublishedReplayAgeMs = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
function isNotFound(error: unknown): boolean {
	if (!isRecord(error)) return false;
	return error.code === '404' || error.status === 404;
}
function assertPublishableBrokerJob(job: HistoryArchiveBrokerJob): void {
	if (job.priority !== 0 && job.priority !== 1 && job.priority !== 2)
		throw new Error('Invalid archive broker publish priority');
	if (!Number.isSafeInteger(job.selectedOrdinal) || job.selectedOrdinal < 1)
		throw new Error('Invalid archive broker selected ordinal');
}

export function shouldReplayOrphanedPublishedJobs(
	availableCapacity: number,
	now: number,
	nextReplayAt: number
): boolean {
	return availableCapacity > 0 && now >= nextReplayAt;
}

export async function publishHistoryArchiveBrokerJobs(
	jetStream: Pick<JetStreamClient, 'publish'>,
	repository: Pick<HistoryArchiveBrokerFrontierRepository, 'resetPublished'>,
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
				const payload = Buffer.from(
					JSON.stringify({ executionId: job.executionId, job: job.job })
				);
				// The database execution UUID is also the JetStream de-duplication ID.
				// Replaying one reservation must never create concurrent downloads.
				await jetStream.publish(subject, payload, {
					msgID: job.executionId,
					timeout: 5_000
				});
				return job.executionId;
			})
		);
		const failedExecutionIds = results.flatMap((result, index) =>
			result.status === 'rejected' ? [priorityClass[index]!.executionId] : []
		);
		await repository.resetPublished(failedExecutionIds);
		const failed = results.find((result) => result.status === 'rejected');
		if (failed?.status === 'rejected') throw failed.reason;
		classStart = classEnd;
	}
}

export async function replayPublishedHistoryArchiveBrokerJobs(
	jetStream: Pick<JetStreamClient, 'publish'>,
	repository: Pick<
		HistoryArchiveBrokerFrontierRepository,
		'findPublishedJobs' | 'resetPublished'
	>,
	subject: string,
	highWatermark: number,
	maximumPriority: HistoryArchiveBrokerJob['priority'],
	canonicalFirstRoot: string | null = null
): Promise<void> {
	await publishHistoryArchiveBrokerJobs(
		jetStream,
		repository,
		subject,
		await repository.findPublishedJobs(
			highWatermark,
			maximumPriority,
			canonicalFirstRoot
		)
	);
}

export class HistoryArchiveBrokerDispatcher {
	private connection: NatsConnection | null = null;
	private capacitySubscription: Subscription | null = null;
	private jetStream: JetStreamClient | null = null;
	private manager: JetStreamManager | null = null;
	private readyListener: PostgresNotificationClient | null = null;
	private nextOrphanedPublishedReplayAt = 0;
	private wakeVersion = 0;
	private readonly wakeWaiters = new Set<() => void>();
	private stopping = false;
	private readonly reportConsumerState;
	private readonly frontierMaintenance: ArchiveBrokerFrontierMaintenance;
	private readonly adaptiveMaintenance: ArchiveBrokerAdaptiveMaintenance;

	constructor(
		private readonly repository: HistoryArchiveBrokerFrontierRepository,
		private readonly config: HistoryArchiveBrokerConfig,
		private readonly logger: Logger
	) {
		this.reportConsumerState = createArchiveBrokerConsumerStateReporter(logger);
		this.frontierMaintenance = new ArchiveBrokerFrontierMaintenance(
			repository,
			config,
			logger,
			() => this.signalWork()
		);
		this.adaptiveMaintenance = new ArchiveBrokerAdaptiveMaintenance(
			repository,
			logger,
			() => this.signalWork()
		);
	}
	async run(): Promise<void> {
		await this.initialize();
		await this.initializeReadyListener();
		while (!this.stopping) {
			let observedWakeVersion = this.wakeVersion;
			try {
				const broker = await this.getBrokerCapacity();
				const capacity = broker.availableCapacity;
				if (capacity < 1) {
					await this.waitForWork(observedWakeVersion);
					continue;
				}
				if (await this.replayOrphanedPublishedJobs(broker)) continue;
				const limit = Math.min(capacity, this.config.batchSize);
				const reserve = async (root = this.config.canonicalFirstRoot) => {
					// Consume only wakes preceding this SELECT; later events must survive.
					observedWakeVersion = this.wakeVersion;
					return this.repository.reserveJobs(
						limit,
						this.config.maximumPerHost,
						this.config.maximumPriority,
						root
					);
				};
				await this.repository.admitDailyTransientSourceRetries(limit);
				const adaptive = this.adaptiveMaintenance.run(limit);
				let jobs = await reserve();
				if (jobs.length === 0) {
					const changed = await adaptive;
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (jobs.length === 0) {
					const changed = await this.frontierMaintenance.run();
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (jobs.length === 0) {
					const changed = await this.repository.ensureFrontier(
						this.config.canonicalFirstRoot
					);
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (jobs.length === 0 && this.config.canonicalFirstRoot !== null) {
					await this.repository.ensurePrefetch(null);
					// A broader root scope also requires a SELECT even without new work.
					jobs = await reserve(null);
					if (jobs.length === 0) {
						const changed = await this.repository.ensureFrontier(null);
						if (changed > 0 || this.wakeVersion !== observedWakeVersion)
							jobs = await reserve(null);
					}
				}
				if (jobs.length === 0) {
					await this.waitForWork(observedWakeVersion);
					continue;
				}
				await this.publish(jobs);
			} catch (error) {
				this.logger.error('Archive broker dispatch iteration failed', {
					errorMessage: error instanceof Error ? error.message : String(error)
				});
				await this.waitForWork(observedWakeVersion);
			}
		}
	}
	private async replayOrphanedPublishedJobs(
		broker: ArchiveBrokerCapacity
	): Promise<boolean> {
		const now = Date.now();
		if (
			!shouldReplayOrphanedPublishedJobs(
				broker.availableCapacity,
				now,
				this.nextOrphanedPublishedReplayAt
			)
		) {
			return false;
		}
		this.nextOrphanedPublishedReplayAt =
			now + orphanedPublishedReplayIntervalMs;
		// Only an empty broker permits invalidating unconsumed published tokens.
		// Run that cleanup before optional frontier maintenance can time out.
		if (broker.empty) {
			const requeued = await this.repository.requeueOrphanedPublishedJobs(
				new Date(now - orphanedPublishedReplayAgeMs),
				this.config.highWatermark
			);
			if (requeued > 0) return true;
		}
		const reclaimed = await reconcileSuppressedPublications(
			this.repository,
			() => this.requireManager(),
			this.config,
			new Date(now - orphanedPublishedReplayAgeMs)
		);
		if (reclaimed > 0) return true;
		// Do not put optional frontier I/O ahead of already-admitted fresh work.
		void this.frontierMaintenance.run();
		const jobs = await this.repository.findPublishedJobs(
			this.config.highWatermark,
			this.config.maximumPriority,
			this.config.canonicalFirstRoot,
			new Date(now - orphanedPublishedReplayAgeMs)
		);
		if (jobs.length === 0) return false;
		await this.publish(jobs);
		return true;
	}
	async close(): Promise<void> {
		this.stopping = true;
		this.signalWork();
		await Promise.all([
			this.frontierMaintenance.close(),
			this.adaptiveMaintenance.close()
		]);
		const readyListener = this.readyListener;
		this.readyListener = null;
		if (readyListener !== null)
			await readyListener.end().catch(() => undefined);
		this.capacitySubscription?.unsubscribe();
		this.capacitySubscription = null;
		const connection = this.connection;
		this.connection = null;
		this.jetStream = null;
		this.manager = null;
		if (connection !== null) await connection.drain();
	}
	private async initializeReadyListener(): Promise<void> {
		const connectionString = process.env.ACTIVE_DATABASE_URL;
		if (!connectionString)
			throw new Error('ACTIVE_DATABASE_URL is required for broker wake events');
		const listener = new PostgresClient({ connectionString });
		listener.on('notification', (notification: PostgresNotification) => {
			if (notification.channel === historyArchiveReadyNotificationChannel)
				this.signalWork();
		});
		listener.on('error', (error: Error) => {
			this.logger.error('Archive broker ready listener failed', {
				errorMessage: error.message
			});
			this.signalWork();
		});
		try {
			await listener.connect();
			await listener.query('listen ' + historyArchiveReadyNotificationChannel);
			this.readyListener = listener;
		} catch (error) {
			await listener.end().catch(() => undefined);
			throw error;
		}
	}
	private signalWork(): void {
		this.wakeVersion++;
		const waiters = [...this.wakeWaiters];
		for (const resolve of waiters) resolve();
	}
	private async waitForWork(observedWakeVersion: number): Promise<void> {
		if (this.stopping || this.wakeVersion !== observedWakeVersion) return;
		await new Promise<void>((resolve) => {
			let timer: NodeJS.Timeout | undefined;
			const finish = (): void => {
				if (!this.wakeWaiters.delete(finish)) return;
				if (timer !== undefined) clearTimeout(timer);
				resolve();
			};
			this.wakeWaiters.add(finish);
			timer = setTimeout(finish, this.config.pollIntervalMs);
			if (this.stopping || this.wakeVersion !== observedWakeVersion) finish();
		});
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
			this.listenForCapacity(connection);
			await replayPublishedHistoryArchiveBrokerJobs(
				jetStream,
				this.repository,
				this.config.subject,
				Math.min(
					this.config.highWatermark,
					(await this.getBrokerCapacity()).availableCapacity
				),
				this.config.maximumPriority,
				this.config.canonicalFirstRoot
			);
		} catch (error) {
			this.connection = null;
			this.jetStream = null;
			this.manager = null;
			await connection.close();
			throw error;
		}
	}
	private listenForCapacity(connection: NatsConnection): void {
		const subscription = connection.subscribe(
			this.config.capacitySignalSubject
		);
		this.capacitySubscription = subscription;
		void (async () => {
			try {
				for await (const _message of subscription) this.signalWork();
			} catch (error) {
				if (!this.stopping) {
					this.logger.error('Archive broker capacity listener failed', {
						errorMessage: error instanceof Error ? error.message : String(error)
					});
				}
			}
		})();
	}

	private async ensureStream(manager: JetStreamManager): Promise<boolean> {
		const desired = {
			discard: DiscardPolicy.New,
			duplicate_window: nanos(24 * 60 * 60 * 1_000),
			max_age: 0,
			max_bytes: 64 * 1024 * 1024,
			max_msg_size: 64 * 1024,
			max_msgs: calculateHistoryArchiveBrokerStreamMessageLimit(
				this.config.highWatermark
			),
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

	private async getBrokerCapacity(): Promise<ArchiveBrokerCapacity> {
		const manager = this.requireManager();
		const occupancy = await readArchiveBrokerOccupancy(
			() => manager.consumers.info(this.config.stream, this.config.consumer),
			() => manager.streams.info(this.config.stream)
		);
		this.reportConsumerState(occupancy);
		return getArchiveBrokerCapacity(this.config.highWatermark, occupancy);
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
