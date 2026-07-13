import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type {
	HistoryArchiveObjectEventOptions,
	HistoryArchiveObjectEventPage,
	HistoryArchiveObjectEventRepository
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEventRepository.js';

const maxEventLimit = 5000;
const defaultEventLimit = 250;

@injectable()
export class TypeOrmHistoryArchiveObjectEventRepository implements HistoryArchiveObjectEventRepository {
	constructor(
		private readonly repository: Repository<HistoryArchiveObjectEvent>
	) {}

	async appendFromObject(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void> {
		await this.repository.insert(createEvent(object, options));
	}

	async appendFromObjectIdempotently(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void> {
		const claimAttempt = options.claimAttempt ?? object.attempts;
		await this.repository.manager.transaction(async (manager) => {
			await manager.query(
				`select pg_advisory_xact_lock(hashtextextended($1::text, 8191))`,
				[`${object.remoteId}:${options.eventType}:${claimAttempt}`]
			);
			const [existing] = (await manager.query(
				`select 1 from "history_archive_object_event"
				 where "objectRemoteId" = $1::uuid
				 and "eventType" = $2::text
				 and "claimAttempt" = $3::integer
				 limit 1`,
				[object.remoteId, options.eventType, claimAttempt]
			)) as readonly unknown[];
			if (existing !== undefined) return;
			await manager.insert(
				HistoryArchiveObjectEvent,
				createEvent(object, { ...options, claimAttempt })
			);
		});
	}

	async findRecent(options: {
		readonly archiveUrlIdentity?: string;
		readonly limit: number;
	}): Promise<HistoryArchiveObjectEventPage> {
		const limit = normalizeLimit(options.limit);
		const query = this.repository
			.createQueryBuilder('event')
			.orderBy('event.createdAt', 'DESC')
			.addOrderBy('event.id', 'DESC')
			.take(limit);
		if (options.archiveUrlIdentity !== undefined) {
			query.where('event.archiveUrlIdentity = :archiveUrlIdentity', {
				archiveUrlIdentity: options.archiveUrlIdentity
			});
		}

		const [events, count] = await Promise.all([
			query.getMany(),
			this.findMaintainedEventCount(options.archiveUrlIdentity)
		]);

		return { count, events, limit };
	}

	private async findMaintainedEventCount(
		archiveUrlIdentity: string | undefined
	): Promise<number> {
		const rows: unknown = await this.repository.manager.query(
			`
				select coalesce(sum("eventCount"), 0)::text as count
				from history_archive_object_event_summary
				where $1::text is null or "archiveUrlIdentity" = $1::text
			`,
			[archiveUrlIdentity ?? null]
		);
		if (!Array.isArray(rows) || !isCountRow(rows[0])) {
			throw new Error('History archive event summary count is invalid');
		}
		const count = Number(rows[0].count);
		if (!Number.isSafeInteger(count) || count < 0) {
			throw new Error('History archive event summary count is invalid');
		}
		return count;
	}
}

function createEvent(
	object: HistoryArchiveObject,
	options: HistoryArchiveObjectEventOptions
): HistoryArchiveObjectEvent {
	return new HistoryArchiveObjectEvent({
		archiveUrl: object.archiveUrl,
		archiveUrlIdentity: object.archiveUrlIdentity,
		bucketHash: object.bucketHash,
		bytesDownloaded: object.bytesDownloaded,
		checkpointLedger: object.checkpointLedger,
		claimAttempt: options.claimAttempt ?? object.attempts,
		errorMessage: object.errorMessage,
		errorType: object.errorType,
		eventType: options.eventType,
		evidenceClass: options.evidenceClass ?? null,
		failureChannel: object.failureChannel,
		httpStatus: object.httpStatus,
		nextAttemptAt: object.nextAttemptAt,
		objectKey: object.objectKey,
		objectRemoteId: object.remoteId,
		objectType: object.objectType,
		objectUrl: object.objectUrl,
		verificationFacts: object.verificationFacts,
		workerStage: object.workerStage
	});
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return defaultEventLimit;

	return Math.min(limit, maxEventLimit);
}

function isCountRow(value: unknown): value is { readonly count: string } {
	return (
		typeof value === 'object' &&
		value !== null &&
		'count' in value &&
		typeof value.count === 'string'
	);
}
