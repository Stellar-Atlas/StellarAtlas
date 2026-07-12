import { In, type EntityManager, type SelectQueryBuilder } from 'typeorm';
import { HistoryArchiveObjectEvent } from '../../../domain/history-archive-object/HistoryArchiveObjectEvent.js';
import type { KnownArchiveObjectEventPageRequest } from '../../../domain/known-archive-evidence/KnownArchiveEvidenceRepository.js';

export async function findKnownArchiveObjectEventPage(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveObjectEventPageRequest
): Promise<{
	readonly events: readonly HistoryArchiveObjectEvent[];
	readonly total: number;
}> {
	if (archiveUrlIdentities.length === 0) return { events: [], total: 0 };
	if (page.snapshotTotal === 0) return { events: [], total: 0 };

	const repository = manager.getRepository(HistoryArchiveObjectEvent);
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
	const totalPromise: Promise<number> =
		page.snapshotTotal === null
			? baseQuery.getCount()
			: Promise.resolve(page.snapshotTotal);
	const pageKeyResult: Promise<unknown> = manager.query(
		knownArchiveObjectEventPageKeysSql,
		[
			archiveUrlIdentities,
			page.filters.archiveUrlIdentity,
			page.filters.evidenceClass,
			page.filters.eventType,
			page.filters.objectType,
			page.snapshotAt,
			page.before?.at ?? null,
			page.before?.remoteId ?? null,
			page.limit + 1
		]
	);
	const [total, keyResult] = await Promise.all([totalPromise, pageKeyResult]);
	const remoteIds = requireEventPageRemoteIds(keyResult);
	if (remoteIds.length === 0) return { events: [], total };

	const events = await repository.findBy({ remoteId: In(remoteIds) });
	const eventsById = new Map(events.map((event) => [event.remoteId, event]));
	return {
		events: remoteIds.map((remoteId) => {
			const event = eventsById.get(remoteId);
			if (event === undefined) {
				throw new Error('Known archive event page hydration missed a key');
			}
			return event;
		}),
		total
	};
}

export const knownArchiveObjectEventPageKeysSql = `
	with requested_roots as materialized (
		select distinct identity as "archiveUrlIdentity"
		from unnest($1::text[]) requested(identity)
		where $2::text is null or identity = $2::text
	), page_keys as materialized (
		select candidate."createdAt", candidate."remoteId"
		from requested_roots requested_root
		cross join lateral (
			select event."createdAt", event."remoteId"
			from history_archive_object_event event
			where event."archiveUrlIdentity" =
					requested_root."archiveUrlIdentity"
				and ($3::text is null or event."evidenceClass" = $3::text)
				and ($4::text is null or event."eventType" = $4::text)
				and ($5::text is null or event."objectType" = $5::text)
				and event."createdAt" <= $6::timestamptz
				and (
					$7::timestamptz is null
					or (
						event."createdAt",
						event."remoteId"
					) < ($7::timestamptz, $8::uuid)
				)
			order by event."createdAt" desc, event."remoteId" desc
			limit $9
		) candidate
		order by candidate."createdAt" desc, candidate."remoteId" desc
		limit $9
	)
	select "remoteId"
	from page_keys
	order by "createdAt" desc, "remoteId" desc
`;

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

function requireEventPageRemoteIds(value: unknown): readonly string[] {
	if (!Array.isArray(value)) {
		throw new Error('Known archive event page keys did not return rows');
	}
	const values: unknown[] = value;
	return values.map((item) => {
		if (!isQueryRow(item)) {
			throw new Error('Known archive event page key is invalid');
		}
		const remoteId = item.remoteId ?? item.remoteid;
		if (typeof remoteId !== 'string' || remoteId.length === 0) {
			throw new Error('Known archive event page key is missing remoteId');
		}
		return remoteId;
	});
}

function isQueryRow(
	value: unknown
): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
