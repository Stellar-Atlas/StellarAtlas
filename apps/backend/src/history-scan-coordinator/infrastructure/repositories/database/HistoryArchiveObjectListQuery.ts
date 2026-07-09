import type { EntityManager } from 'typeorm';
import {
	createObjectFromRow,
	extractRows,
	statusRankSql,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';
import type { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';

export interface HistoryArchiveObjectListOptions {
	readonly archiveUrlIdentity?: string;
	readonly limit: number;
	readonly maxActiveObjectsPerArchive: number;
	readonly maxActiveObjectsPerHost: number;
	readonly maxActiveObjectsTotal: number;
}

export async function findHistoryArchiveObjects(
	manager: EntityManager,
	options: HistoryArchiveObjectListOptions
): Promise<readonly HistoryArchiveObject[]> {
	const rows = extractRows(
		(await manager.query(historyArchiveObjectListSql(), [
			options.maxActiveObjectsPerArchive,
			options.maxActiveObjectsTotal,
			options.maxActiveObjectsPerHost,
			options.archiveUrlIdentity ?? null,
			options.limit
		])) as RawObjectQueryResult
	);

	return rows.map(createObjectFromRow);
}

function historyArchiveObjectListSql(): string {
	return `
		with
		active_total as (
			select count(*)::int as active_count
			from history_archive_object_queue
			where status = 'scanning'
		),
		active_archive as (
			select "archiveUrlIdentity", count(*)::int as active_count
			from history_archive_object_queue
			where status = 'scanning'
			group by "archiveUrlIdentity"
		),
		active_host as (
			select "hostIdentity", count(*)::int as active_count
			from history_archive_object_queue
			where status = 'scanning'
			group by "hostIdentity"
		),
		host_throttle as (
			select "hostIdentity", max("blockedUntil") as "blockedUntil"
			from history_archive_object_host_throttle
			where "blockedUntil" > now()
			group by "hostIdentity"
		),
		status_candidates as (
			${statusCandidateSql('scanning')}
			union all
			${statusCandidateSql('failed')}
			union all
			${statusCandidateSql('pending')}
			union all
			${statusCandidateSql('verified')}
		),
		target_objects as (
			select *
			from status_candidates archive_object
			order by
				${statusRankSql('archive_object.status')} asc,
				archive_object."objectOrder" asc,
				archive_object."objectKey" asc,
				archive_object."archiveUrlIdentity" asc,
				archive_object."updatedAt" desc
			limit $5
		)
		select
			archive_object."remoteId" as "remoteId",
			archive_object."archiveUrl" as "archiveUrl",
			archive_object."archiveUrlIdentity" as "archiveUrlIdentity",
			archive_object."hostIdentity" as "hostIdentity",
			archive_object."objectType" as "objectType",
			archive_object."objectKey" as "objectKey",
			archive_object."objectOrder" as "objectOrder",
			archive_object."objectUrl" as "objectUrl",
			archive_object.status as "status",
			archive_object."workerStage" as "workerStage",
			archive_object."checkpointLedger" as "checkpointLedger",
			archive_object."bucketHash" as "bucketHash",
			archive_object."bytesDownloaded" as "bytesDownloaded",
			archive_object.attempts as "attempts",
			archive_object."nextAttemptAt" as "nextAttemptAt",
			archive_object."refreshAfter" as "refreshAfter",
			archive_object."claimedAt" as "claimedAt",
			archive_object."claimedByCommunityScannerId"
				as "claimedByCommunityScannerId",
			archive_object."errorType" as "errorType",
			archive_object."errorMessage" as "errorMessage",
			archive_object."httpStatus" as "httpStatus",
			archive_object."verificationFacts" as "verificationFacts",
			archive_object."verifiedAt" as "verifiedAt",
			archive_object."createdAt" as "createdAt",
			archive_object."updatedAt" as "updatedAt",
			case
				when archive_object.status = 'scanning'
					then 'object-already-active'
				when host_throttle."blockedUntil" is not null
					then 'host-backoff'
				when archive_object.status = 'failed'
					and coalesce(
						archive_object."nextAttemptAt",
						archive_object."updatedAt" + interval '1 hour'
					) > now()
					then 'retry-window'
				when active_total.active_count >= $2
					then 'global-active-cap'
				when coalesce(active_archive.active_count, 0) >= $1
					then 'archive-active-cap'
				when coalesce(active_host.active_count, 0) >= $3
					then 'host-active-cap'
				else null
			end as "delayReasonCode",
			case
				when host_throttle."blockedUntil" is not null
					then host_throttle."blockedUntil"
				when archive_object.status = 'failed'
					and coalesce(
						archive_object."nextAttemptAt",
						archive_object."updatedAt" + interval '1 hour'
					) > now()
					then coalesce(
						archive_object."nextAttemptAt",
						archive_object."updatedAt" + interval '1 hour'
					)
				else null
			end as "delayReasonUntil"
		from target_objects archive_object
		cross join active_total
		left join active_archive
			on active_archive."archiveUrlIdentity" =
				archive_object."archiveUrlIdentity"
		left join active_host
			on active_host."hostIdentity" = archive_object."hostIdentity"
		left join host_throttle
			on host_throttle."hostIdentity" = archive_object."hostIdentity"
		order by
			${statusRankSql('archive_object.status')} asc,
			archive_object."objectOrder" asc,
			archive_object."objectKey" asc,
			archive_object."archiveUrlIdentity" asc,
			archive_object."updatedAt" desc
		limit $5
	`;
}

function statusCandidateSql(status: string): string {
	return `
		(
			select archive_object.*
			from history_archive_object_queue archive_object
			where archive_object.status = '${status}'
				and (
					$4::text is null
					or archive_object."archiveUrlIdentity" = $4::text
				)
			order by
				archive_object."objectOrder" asc,
				archive_object."objectKey" asc,
				archive_object."archiveUrlIdentity" asc,
				archive_object."updatedAt" desc
			limit $5
		)
	`;
}
