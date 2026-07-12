import type { Repository, SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveObjectEvent } from '../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type { KnownArchiveObjectEventPageRequest } from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';

export async function findKnownArchiveObjectEventPage(
	repository: Repository<HistoryArchiveObjectEvent>,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveObjectEventPageRequest
): Promise<{
	readonly events: readonly HistoryArchiveObjectEvent[];
	readonly total: number;
}> {
	if (archiveUrlIdentities.length === 0) return { events: [], total: 0 };

	const baseQuery = applyFilters(
		repository
			.createQueryBuilder('event')
			.where('event.archiveUrlIdentity in (:...archiveUrlIdentities)', {
				archiveUrlIdentities
			}),
		page
	).andWhere('event.createdAt <= :snapshotAt', {
		snapshotAt: page.snapshotAt
	});
	const pageQuery = baseQuery.clone();
	if (page.before !== null) {
		pageQuery.andWhere(
			'(event.createdAt < :cursorAt or (event.createdAt = :cursorAt and event.remoteId < :cursorRemoteId))',
			{
				cursorAt: page.before.at,
				cursorRemoteId: page.before.remoteId
			}
		);
	}
	pageQuery
		.orderBy('event.createdAt', 'DESC')
		.addOrderBy('event.remoteId', 'DESC')
		.take(page.limit + 1);

	const total = page.snapshotTotal ?? (await baseQuery.getCount());
	const events = await pageQuery.getMany();
	return { events, total };
}

function applyFilters(
	query: SelectQueryBuilder<HistoryArchiveObjectEvent>,
	page: KnownArchiveObjectEventPageRequest
): SelectQueryBuilder<HistoryArchiveObjectEvent> {
	const filters = page.filters;
	if (filters.archiveUrlIdentity !== null) {
		query.andWhere('event.archiveUrlIdentity = :archiveUrlIdentity', {
			archiveUrlIdentity: filters.archiveUrlIdentity
		});
	}
	if (filters.evidenceClass !== null) {
		query.andWhere('event.evidenceClass = :evidenceClass', {
			evidenceClass: filters.evidenceClass
		});
	}
	if (filters.eventType !== null) {
		query.andWhere('event.eventType = :eventType', {
			eventType: filters.eventType
		});
	}
	if (filters.objectType !== null) {
		query.andWhere('event.objectType = :objectType', {
			objectType: filters.objectType
		});
	}
	return query;
}
