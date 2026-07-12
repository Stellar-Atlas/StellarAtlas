import { In, type EntityManager } from 'typeorm';
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
	const totalPromise: Promise<number> =
		page.snapshotTotal === null
			? findEventTotal(manager, archiveUrlIdentities, page)
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

export const knownArchiveObjectEventTotalSql = `
	with summarized as (
		select coalesce(sum(summary."eventCount"), 0)::bigint as total
		from history_archive_object_event_summary summary
		where summary."archiveUrlIdentity" = any($1::text[])
			and ($2::text is null or summary."archiveUrlIdentity" = $2::text)
			and ($3::text is null or summary."evidenceClass" = $3::text)
			and ($4::text is null or summary."eventType" = $4::text)
			and ($5::text is null or summary."objectType" = $5::text)
	), after_snapshot as (
		select count(*)::bigint as total
		from history_archive_object_event event
		where event."archiveUrlIdentity" = any($1::text[])
			and ($2::text is null or event."archiveUrlIdentity" = $2::text)
			and ($3::text is null or event."evidenceClass" = $3::text)
			and ($4::text is null or event."eventType" = $4::text)
			and ($5::text is null or event."objectType" = $5::text)
			and event."createdAt" > $6::timestamptz
	)
	select greatest(summarized.total - after_snapshot.total, 0)::bigint as total
	from summarized, after_snapshot
`;

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

async function findEventTotal(
	manager: EntityManager,
	archiveUrlIdentities: readonly string[],
	page: KnownArchiveObjectEventPageRequest
): Promise<number> {
	const value: unknown = await manager.query(knownArchiveObjectEventTotalSql, [
		archiveUrlIdentities,
		page.filters.archiveUrlIdentity,
		page.filters.evidenceClass,
		page.filters.eventType,
		page.filters.objectType,
		page.snapshotAt
	]);
	if (!Array.isArray(value)) {
		throw new Error('Known archive event total did not return rows');
	}
	const values: unknown[] = value;
	const row = values[0];
	if (!isQueryRow(row)) {
		throw new Error('Known archive event total row is invalid');
	}
	const total = row.total;
	const parsed =
		typeof total === 'number'
			? total
			: typeof total === 'string'
				? Number(total)
				: Number.NaN;
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error('Known archive event total is invalid');
	}
	return parsed;
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
