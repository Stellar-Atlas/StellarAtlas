import type { HistoryArchiveObjectHostFailure } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';

export const historyArchiveObjectHostThrottleTableName =
	'history_archive_object_host_throttle';

export const historyArchiveObjectHostFailureUpsertSql = `
	insert into "history_archive_object_host_throttle" (
		"hostIdentity",
		"archiveUrlIdentity",
		"failureClass",
		"evidenceClass",
		"errorType",
		"httpStatus",
		"blockedUntil",
		"retryAfterUntil",
		"lastFailureAt",
		"consecutiveFailures",
		"createdAt",
		"updatedAt"
	)
	values ($1, $2, $3, $4, $5, $6, $7, $8, now(), 1, now(), now())
	on conflict ("hostIdentity")
	do update set
		"archiveUrlIdentity" = excluded."archiveUrlIdentity",
		"failureClass" = excluded."failureClass",
		"evidenceClass" = excluded."evidenceClass",
		"errorType" = excluded."errorType",
		"httpStatus" = excluded."httpStatus",
		"blockedUntil" = greatest(
			"history_archive_object_host_throttle"."blockedUntil",
			excluded."blockedUntil"
		),
		"retryAfterUntil" = case
			when excluded."retryAfterUntil" is null then
				"history_archive_object_host_throttle"."retryAfterUntil"
			when "history_archive_object_host_throttle"."retryAfterUntil" is null then
				excluded."retryAfterUntil"
			else greatest(
				"history_archive_object_host_throttle"."retryAfterUntil",
				excluded."retryAfterUntil"
			)
		end,
		"lastFailureAt" = excluded."lastFailureAt",
		"consecutiveFailures" =
			case
				when "history_archive_object_host_throttle"."blockedUntil" > now()
					then "history_archive_object_host_throttle"."consecutiveFailures" + 1
				else 1
			end,
		"updatedAt" = now()
`;

export const historyArchiveObjectHostThrottleDeleteSql = `
	delete from "history_archive_object_host_throttle"
	where "hostIdentity" = $1
`;

export function toHistoryArchiveObjectHostFailureSqlParams(
	failure: HistoryArchiveObjectHostFailure
): readonly unknown[] {
	return [
		failure.hostIdentity,
		failure.archiveUrlIdentity,
		failure.failureClass,
		failure.evidenceClass,
		failure.errorType,
		failure.httpStatus ?? null,
		failure.blockedUntil,
		failure.retryAfterUntil ?? null
	];
}
