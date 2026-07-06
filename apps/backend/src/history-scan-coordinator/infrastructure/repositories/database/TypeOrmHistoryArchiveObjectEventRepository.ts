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
export class TypeOrmHistoryArchiveObjectEventRepository
	implements HistoryArchiveObjectEventRepository
{
	constructor(
		private readonly repository: Repository<HistoryArchiveObjectEvent>
	) {}

	async appendFromObject(
		object: HistoryArchiveObject,
		options: HistoryArchiveObjectEventOptions
	): Promise<void> {
		const event = new HistoryArchiveObjectEvent({
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
			httpStatus: object.httpStatus,
			nextAttemptAt: object.nextAttemptAt,
			objectKey: object.objectKey,
			objectRemoteId: object.remoteId,
			objectType: object.objectType,
			objectUrl: object.objectUrl,
			verificationFacts: object.verificationFacts,
			workerStage: object.workerStage
		});

		await this.repository.insert(event);
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

		const [events, count] = await query.getManyAndCount();

		return { count, events, limit };
	}
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return defaultEventLimit;

	return Math.min(limit, maxEventLimit);
}
