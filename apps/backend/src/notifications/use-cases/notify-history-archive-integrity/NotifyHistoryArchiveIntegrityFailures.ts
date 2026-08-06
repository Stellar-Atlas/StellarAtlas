import { inject, injectable } from 'inversify';
import { err, ok, type Result } from 'neverthrow';
import type { Logger } from 'winston';
import type { ExceptionLogger } from '@core/services/ExceptionLogger.js';
import { mapUnknownToError } from '@core/utilities/mapUnknownToError.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRepository } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { TYPES as HISTORY_TYPES } from '@history-scan-coordinator/infrastructure/di/di-types.js';
import { isArchiveObjectEvidence, isRepairableObjectFailure } from '@history-scan-coordinator/use-cases/get-history-archive-repair-plan/HistoryArchiveRepairActionMapper.js';
import type { OwnedKnownArchiveRoot } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/GetKnownArchiveEvidence.js';
import { getOwnedKnownArchiveRoots } from '@history-scan-coordinator/use-cases/get-known-archive-evidence/KnownArchiveRootOwnership.js';
import type { NodeRepository } from '@network-scan/domain/node/NodeRepository.js';
import { NETWORK_TYPES } from '@network-scan/infrastructure/di/di-types.js';
import { PublicKey } from '../../domain/event/EventSourceId.js';
import { HistoryArchiveIntegrityFailureDetectedEvent } from '../../domain/event/Event.js';
import { Notifier } from '../../domain/notifier/Notifier.js';
import type { SubscriberRepository } from '../../domain/subscription/SubscriberRepository.js';
import { HistoryArchiveIntegrityNotificationRunLock } from '../../infrastructure/database/HistoryArchiveIntegrityNotificationRunLock.js';

const defaultObjectsPerArchiveRoot = 50;
const maxObjectsPerArchiveRoot = 100;
const archiveRootReadConcurrency = 4;

export interface NotifyHistoryArchiveIntegrityFailuresOptions {
	readonly objectsPerArchiveRoot?: number;
}

export interface HistoryArchiveIntegrityNotificationRun {
	readonly candidateEvents: number;
	readonly failedNotifications: number;
	readonly inspectedArchiveRoots: number;
	readonly sentNotifications: number;
	readonly skippedDueToConcurrentRun: boolean;
}

@injectable()
export class NotifyHistoryArchiveIntegrityFailures {
	constructor(
		@inject(HISTORY_TYPES.HistoryArchiveObjectRepository)
		private readonly objectRepository: HistoryArchiveObjectRepository,
		@inject(NETWORK_TYPES.NodeRepository)
		private readonly nodeRepository: NodeRepository,
		@inject('SubscriberRepository')
		private readonly subscriberRepository: SubscriberRepository,
		private readonly notifier: Notifier,
		private readonly runLock: HistoryArchiveIntegrityNotificationRunLock,
		@inject('Logger') private readonly logger: Logger,
		@inject('ExceptionLogger')
		private readonly exceptionLogger: ExceptionLogger
	) {}

	async execute(
		options: NotifyHistoryArchiveIntegrityFailuresOptions = {}
	): Promise<Result<HistoryArchiveIntegrityNotificationRun, Error>> {
		try {
			const run = await this.runLock.tryRun(() => this.executeLocked(options));
			if (run.acquired && run.value !== undefined) return ok(run.value);
			return ok({
				candidateEvents: 0,
				failedNotifications: 0,
				inspectedArchiveRoots: 0,
				sentNotifications: 0,
				skippedDueToConcurrentRun: true
			});
		} catch (cause) {
			const error = mapUnknownToError(cause);
			this.exceptionLogger.captureException(error);
			return err(error);
		}
	}

	private async executeLocked(
		options: NotifyHistoryArchiveIntegrityFailuresOptions
	): Promise<HistoryArchiveIntegrityNotificationRun> {
		const roots = getOwnedKnownArchiveRoots(
			(await this.nodeRepository.findAllKnown()).map((node) => ({
				historyUrl: node.details?.historyUrl ?? null,
				publicKey: node.publicKey.value
			}))
		);
		const candidates = await this.findCandidates(
			roots,
			normalizeObjectsPerArchiveRoot(options.objectsPerArchiveRoot)
		);
		const subscribers = await this.subscriberRepository.find();
		const notifications = subscribers.flatMap((subscriber) => {
			const notification = subscriber.publishNotificationAbout(candidates, new Date());
			return notification === null ? [] : [notification];
		});
		if (notifications.length === 0) {
			return {
				candidateEvents: candidates.length,
				failedNotifications: 0,
				inspectedArchiveRoots: roots.length,
				sentNotifications: 0,
				skippedDueToConcurrentRun: false
			};
		}

		const delivery = await this.notifier.sendNotifications(notifications);
		await this.subscriberRepository.save(
			delivery.successfulNotifications.map((notification) => notification.subscriber)
		);
		delivery.failedNotifications.forEach((failure) =>
			this.exceptionLogger.captureException(failure.cause)
		);
		this.logger.info('Sent archive integrity notifications', {
			candidateEvents: candidates.length,
			failedNotifications: delivery.failedNotifications.length,
			inspectedArchiveRoots: roots.length,
			sentNotifications: delivery.successfulNotifications.length
		});

		return {
			candidateEvents: candidates.length,
			failedNotifications: delivery.failedNotifications.length,
			inspectedArchiveRoots: roots.length,
			sentNotifications: delivery.successfulNotifications.length,
			skippedDueToConcurrentRun: false
		};
	}

	private async findCandidates(
		roots: readonly OwnedKnownArchiveRoot[],
		objectsPerArchiveRoot: number
	): Promise<readonly HistoryArchiveIntegrityFailureDetectedEvent[]> {
		const candidateGroups = await mapWithConcurrency(
			roots,
			archiveRootReadConcurrency,
			async (root) => {
				const objects = await this.objectRepository.findActionableByArchiveUrl(
					root.archiveUrl,
					objectsPerArchiveRoot
				);
				return objects.flatMap((object) =>
					isCurrentIntegrityFailure(object)
						? root.nodePublicKeys.flatMap((publicKey) =>
							toIntegrityEvent(object, publicKey)
						)
						: []
				);
			}
		);
		return candidateGroups.flat().toSorted((left, right) =>
			left.time.getTime() - right.time.getTime()
		);
	}
}

function isCurrentIntegrityFailure(object: HistoryArchiveObject): boolean {
	return isArchiveObjectEvidence(object) && isRepairableObjectFailure(object);
}

function toIntegrityEvent(
	object: HistoryArchiveObject,
	publicKeyValue: string
): readonly HistoryArchiveIntegrityFailureDetectedEvent[] {
	const publicKey = PublicKey.create(publicKeyValue);
	const observedAt = object.updatedAt ?? object.createdAt;
	if (publicKey.isErr() || observedAt === undefined) return [];

	return [
		new HistoryArchiveIntegrityFailureDetectedEvent(observedAt, publicKey.value, {
			actionId: `${repairActionKind(object)}:${object.remoteId}`,
			archiveUrl: object.archiveUrl,
			bucketHash: object.bucketHash,
			checkpointLedger: object.checkpointLedger,
			evidenceId: object.remoteId,
			evidenceObservedAt: observedAt.toISOString(),
			failureCode: object.errorType ?? 'integrity-mismatch',
			objectKey: object.objectKey,
			objectType: object.objectType,
			repairPlanPath: `/v1/archive-scans/${encodeURIComponent(object.archiveUrl)}/repair-plan`
		})
	];
}

function repairActionKind(object: HistoryArchiveObject): string {
	if (object.objectType === 'history-archive-state') {
		return 'restore-history-archive-state';
	}
	return object.objectType === 'bucket'
		? 'replace-bucket-file'
		: 'replace-archive-file';
}

function normalizeObjectsPerArchiveRoot(value: number | undefined): number {
	if (value === undefined) return defaultObjectsPerArchiveRoot;
	if (!Number.isSafeInteger(value) || value < 1) return defaultObjectsPerArchiveRoot;
	return Math.min(value, maxObjectsPerArchiveRoot);
}

async function mapWithConcurrency<T, U>(
	items: readonly T[],
	concurrency: number,
	map: (item: T) => Promise<U>
): Promise<readonly U[]> {
	const results = new Array<U>(items.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < items.length) {
			const index = nextIndex++;
			const item = items[index];
			if (item === undefined) continue;
			results[index] = await map(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
	);
	return results;
}
