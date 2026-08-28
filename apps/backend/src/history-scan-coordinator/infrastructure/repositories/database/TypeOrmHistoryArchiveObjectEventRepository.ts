import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { createHash } from 'node:crypto';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import { HistoryArchiveObjectEvent } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type {
	HistoryArchiveObjectEventAppend,
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
		await this.appendFromObjectsIdempotently([{ object, options }]);
	}

	async appendFromObjectsIdempotently(
		events: readonly HistoryArchiveObjectEventAppend[]
	): Promise<void> {
		const values = events.map(({ object, options }) => {
			const claimAttempt = options.claimAttempt ?? object.attempts;
			return createEvent(
				object,
				{ ...options, claimAttempt },
				createIdempotentEventRemoteId(
					object.remoteId,
					options.eventType,
					claimAttempt
				)
			);
		});
		if (values.length === 0) return;
		await this.repository
			.createQueryBuilder()
			.insert()
			.values(values)
			.orIgnore()
			.execute();
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
	options: HistoryArchiveObjectEventOptions,
	remoteId?: string
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
		remoteId,
		verificationFacts: object.verificationFacts,
		workerStage: object.workerStage
	});
}

function createIdempotentEventRemoteId(
	objectRemoteId: string,
	eventType: HistoryArchiveObjectEventOptions['eventType'],
	claimAttempt: number
): string {
	const digest = createHash('sha256')
		.update('history-archive-object-event-v1\0')
		.update(objectRemoteId)
		.update('\0')
		.update(eventType)
		.update('\0')
		.update(claimAttempt.toString())
		.digest('hex');
	const variant = ((Number.parseInt(digest[16]!, 16) & 0x3) | 0x8).toString(16);
	return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
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
