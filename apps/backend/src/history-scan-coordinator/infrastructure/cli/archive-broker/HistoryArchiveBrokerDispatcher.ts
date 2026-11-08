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
import { ArchiveBrokerReadyListener } from './ArchiveBrokerReadyListener.js';
import { ArchiveBrokerRamDispatch } from './ArchiveBrokerRamDispatch.js';
import { getHistoryArchiveRetryPhase } from '../../repositories/database/HistoryArchiveFirstPassPolicy.js';
import { reserveCanonicalRetryWhenIdle } from '../../repositories/database/HistoryArchiveCanonicalSubstitutionRetry.js';
import {
	createArchiveBrokerConsumerStateReporter,
	readArchiveBrokerOccupancy
} from './ArchiveBrokerConsumerHealth.js';
import {
	calculateHistoryArchiveBrokerStreamMessageLimit,
	getHistoryArchiveBrokerWorkBudget,
	getArchiveBrokerCapacity,
	type ArchiveBrokerCapacity
} from './ArchiveBrokerBuffer.js';
export {
	calculateHistoryArchiveBrokerAvailableCapacity,
	calculateHistoryArchiveBrokerStreamMessageLimit
} from './ArchiveBrokerBuffer.js';

const orphanedPublishedReplayAgeMs = 30_000;
const dispatcherDrainDeadlineMs = 30_000;

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
	private readyListener: ArchiveBrokerReadyListener | null = null;
	private readonly ram: ArchiveBrokerRamDispatch | null;
	private nextOrphanedPublishedReplayAt = 0;
	private wakeVersion = 0;
	private readonly wakeWaiters = new Set<() => void>();
	private stopping = false;
	private runPromise: Promise<void> | null = null;
	private closePromise: Promise<void> | null = null;
	private closeSettlement: Promise<void> | null = null;
	private readonly reportConsumerState;
	private readonly frontierMaintenance: ArchiveBrokerFrontierMaintenance;
	private readonly adaptiveMaintenance: ArchiveBrokerAdaptiveMaintenance;

	constructor(
		private readonly repository: HistoryArchiveBrokerFrontierRepository,
		private readonly config: HistoryArchiveBrokerConfig,
		private readonly logger: Logger
	) {
		this.ram =
			config.ramQueueEnabled === true
				? new ArchiveBrokerRamDispatch(
						repository.createRamCandidateFeed(),
						(ids, root, fallbackObjectIds) =>
							repository.reserveCandidateIds(
								ids,
								config.maximumPerHost,
								config.maximumPriority,
								root,
								fallbackObjectIds
							),
						config,
						logger,
						() => this.signalWork()
					)
				: null;
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
	run(): Promise<void> {
		return (this.runPromise ??= Promise.resolve().then(() => this.runLoop()));
	}
	private async runLoop(): Promise<void> {
		if (this.stopping) return;
		await this.initialize();
		if (this.stopping) return;
		await this.initializeReadyListener();
		while (!this.stopping) {
			let observedWakeVersion = this.wakeVersion;
			try {
				const broker = await this.getBrokerCapacity();
				if (this.stopping) return;
				const capacity = broker.availableCapacity;
				if (capacity < 1) {
					await this.waitForWork(observedWakeVersion);
					continue;
				}
				if (await this.replayOrphanedPublishedJobs(broker)) continue;
				if (this.stopping) return;
				const limit = Math.min(capacity, this.config.batchSize);
				let emptyCanonicalDurable = false;
				const reserve = async (root = this.config.canonicalFirstRoot) => {
					if (this.stopping) return [];
					// Consume only wakes preceding this SELECT; later events must survive.
					observedWakeVersion = this.wakeVersion;
					const afterEmptyCanonicalDurable = root === null && emptyCanonicalDurable;
					if (root === null) emptyCanonicalDurable = false;
					const ramJobs =
						getHistoryArchiveRetryPhase() === 'first-pass'
							? await this.ram?.reserve(limit, root, afterEmptyCanonicalDurable)
							: null;
					if (ramJobs !== undefined && ramJobs !== null) return ramJobs;
					if (this.stopping) return [];
					const durableJobs = await this.repository.reserveJobs(
						limit,
						this.config.maximumPerHost,
						this.config.maximumPriority,
						root
					);
					if (root !== null && root === this.config.canonicalFirstRoot)
						emptyCanonicalDurable = durableJobs.length === 0;
					return durableJobs;
				};
				await this.repository.admitDailyTransientSourceRetries(limit);
				if (this.stopping) return;
				const adaptive = this.adaptiveMaintenance.run(limit);
				let jobs = await reserve();
				if (!this.stopping && jobs.length === 0) {
					const changed = await adaptive;
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (!this.stopping && jobs.length === 0) {
					const changed = await this.frontierMaintenance.run();
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (!this.stopping && jobs.length === 0) {
					const changed = await this.repository.ensureFrontier(
						this.config.canonicalFirstRoot
					);
					if (changed > 0 || this.wakeVersion !== observedWakeVersion)
						jobs = await reserve();
				}
				if (!this.stopping && jobs.length === 0 && this.config.canonicalFirstRoot !== null) {
					await this.repository.ensurePrefetch(null);
					// A broader root scope also requires a SELECT even without new work.
					jobs = await reserve(null);
					if (!this.stopping && jobs.length === 0) {
						const changed = await this.repository.ensureFrontier(null);
						if (changed > 0 || this.wakeVersion !== observedWakeVersion)
							jobs = await reserve(null);
					}
				}
				if (!this.stopping && jobs.length === 0) {
					jobs = await reserveCanonicalRetryWhenIdle({
						currentJobs: jobs,
						capacity,
						admitOne: async () => this.stopping ? 0 :
							await this.repository.admitCanonicalSubstitutionRetry(),
						reserveOne: async () =>
							this.stopping ? [] : await this.repository.reserveJobs(
								1,
								this.config.maximumPerHost,
								this.config.maximumPriority,
								null
							)
					});
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
				if (this.stopping) throw error;
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
		if (this.stopping) return false;
		const reclaimed = await reconcileSuppressedPublications(
			this.repository,
			() => this.requireManager(),
			this.config,
			new Date(now - orphanedPublishedReplayAgeMs)
		);
		if (reclaimed > 0) return true;
		if (this.stopping) return false;
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
	close(timeoutMs = dispatcherDrainDeadlineMs): Promise<void> {
		if (this.closePromise !== null) return this.closePromise;
		this.stopping = true;
		this.ram?.stopAdmission();
		this.readyListener?.stopAdmission();
		this.signalWork();
		const settlement = Promise.resolve().then(() => this.finishClose());
		this.closeSettlement = settlement;
		this.closePromise = new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error(
				`Archive broker drain timed out after ${timeoutMs}ms; handoff is not safe`
			)), timeoutMs);
			settlement.then(
				() => { clearTimeout(timer); resolve(); },
				(error: unknown) => { clearTimeout(timer); reject(error); }
			);
		});
		return this.closePromise;
	}
	/** A deadline reports failure, but it does not authorize closing a live DataSource. */
	waitForShutdown(): Promise<void> {
		return this.closeSettlement ?? Promise.reject(new Error('Archive broker close was not requested'));
	}
	private async finishClose(): Promise<void> {
		const failures: unknown[] = [];
		const settle = async (...operations: (() => unknown)[]) => {
			for (const result of await Promise.allSettled(operations.map(
				(operation) => Promise.resolve().then(operation)
			))) if (result.status === 'rejected') failures.push(result.reason);
		};
		// Both maintenance closes stop admission and join their tasks; neither closes a shared handle.
		await settle(
			() => this.frontierMaintenance.close(),
			() => this.adaptiveMaintenance.close(),
			() => this.runPromise
		);
		const readyListener = this.readyListener;
		this.readyListener = null;
		await settle(() => readyListener?.close(), () => this.ram?.close());
		const subscription = this.capacitySubscription;
		this.capacitySubscription = null;
		await settle(() => subscription?.unsubscribe());
		const connection = this.connection;
		if (connection !== null) {
			try { await connection.drain(); }
			catch (error) {
				failures.push(error);
				await settle(() => connection.close());
			}
		}
		this.connection = null;
		this.jetStream = null;
		this.manager = null;
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, 'Archive broker shutdown failed');
	}
	private async initializeReadyListener(): Promise<void> {
		const connectionString = process.env.ACTIVE_DATABASE_URL;
		if (!connectionString)
			throw new Error('ACTIVE_DATABASE_URL is required for broker wake events');
		this.readyListener = new ArchiveBrokerReadyListener(
			connectionString,
			() => this.signalWork(),
			(payload) => this.ram?.notify(payload),
			(connected) => this.ram?.setConnected(connected),
			this.logger
		);
		await this.readyListener.start();
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
		// Transfer ownership before the next await, including a stop during connect.
		this.connection = connection;
		if (this.stopping) return;
		const jetStream = connection.jetstream();
		const manager = await jetStream.jetstreamManager();
		if (this.stopping) return;
		this.jetStream = jetStream;
		this.manager = manager;
		await this.ensureStream(manager);
		if (this.stopping) return;
		await this.ensureConsumer(manager);
		if (this.stopping) return;
		this.listenForCapacity(connection);
		const { availableCapacity } = await this.getBrokerCapacity();
		if (this.stopping) return;
		await replayPublishedHistoryArchiveBrokerJobs(
			jetStream,
			this.repository,
			this.config.subject,
			Math.min(this.config.highWatermark, availableCapacity),
			this.config.maximumPriority,
			this.config.canonicalFirstRoot
		);
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
			if (this.stopping) return false;
			await manager.streams.update(this.config.stream, desired);
			return false;
		} catch (error) {
			if (!isNotFound(error)) throw error;
			if (this.stopping) return false;
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
			max_ack_pending: getHistoryArchiveBrokerWorkBudget(
				this.config.highWatermark
			).maximumUnacknowledged,
			max_deliver: -1,
			name: this.config.consumer,
			replay_policy: ReplayPolicy.Instant
		};
		try {
			await manager.consumers.info(this.config.stream, this.config.consumer);
			if (this.stopping) return;
			await manager.consumers.update(
				this.config.stream,
				this.config.consumer,
				desired
			);
		} catch (error) {
			if (!isNotFound(error)) throw error;
			if (this.stopping) return;
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
