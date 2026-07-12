import type { Repository } from 'typeorm';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';

const latestActivitySql = `
	select recent_activity."activityAt" as "latestActivityAt"
	from (
		(
			select archive_object."updatedAt" as "activityAt"
			from "history_archive_object_queue" archive_object
			where archive_object.status = 'scanning'
			order by archive_object."updatedAt" desc
			limit 1
		)
		union all
		(
			select object_event."createdAt" as "activityAt"
			from "history_archive_object_event" object_event
			where object_event."eventType" = 'verified'
			order by object_event."createdAt" desc
			limit 1
		)
		union all
		(
			select object_event."createdAt" as "activityAt"
			from "history_archive_object_event" object_event
			where object_event."eventType" = 'failed'
			order by object_event."createdAt" desc
			limit 1
		)
	) recent_activity
	order by recent_activity."activityAt" desc
	limit 1
`;

interface LatestActivityRow {
	readonly latestActivityAt?: unknown;
	readonly latestactivityat?: unknown;
}

export async function findLatestHistoryArchiveObjectActivityAt(
	repository: Pick<Repository<HistoryArchiveObject>, 'query'>
): Promise<Date | null> {
	// Every branch matches an existing leading index and returns at most one row.
	const rows = (await repository.query(
		latestActivitySql
	)) as readonly LatestActivityRow[];
	const value = rows[0]?.latestActivityAt ?? rows[0]?.latestactivityat;

	return parseLatestActivityAt(value);
}

function parseLatestActivityAt(value: unknown): Date | null {
	if (value === undefined || value === null) return null;

	const date =
		value instanceof Date
			? value
			: typeof value === 'string'
				? new Date(value)
				: null;
	if (date === null || Number.isNaN(date.getTime())) {
		throw new Error('Archive object activity query returned an invalid date');
	}

	return date;
}
