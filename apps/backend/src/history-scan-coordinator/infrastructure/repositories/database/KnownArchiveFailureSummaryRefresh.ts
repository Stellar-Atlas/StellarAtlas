import type { DataSource } from 'typeorm';
import type { Logger } from 'logger';
import type { KnownArchiveFailureSummaryV1 } from 'shared';
import { historyArchivePublicSourcePredicateSql } from './HistoryArchivePublicSourceScopeSql.js';
import {
	knownArchiveFailureSummaryTimeoutMs,
	queryKnownArchiveFailureSummary
} from './KnownArchiveFailureSummaryQuery.js';
import {
	archiveFailureSummarySchema,
	archiveFailureSummarySourceStateSql,
	archiveFailureSummaryDigestSql,
	isArchiveFailureSummaryRootRevision,
	queryFingerprint
} from './KnownArchiveFailureSummaryVersion.js';

/** Only trusted current roots with remote findings are grouped. Zero uses existing rollups.
 * Failed aggregates keep their last good snapshot and a durable per-root cooldown;
 * they must not repeatedly compete with verification for cold-table reads.
 */
export const nextArchiveFailureSummaryRootSql = `
	select root."archiveUrlIdentity", source."rootRevision", source."retainedRevision",
		snapshot.xmin::text as "snapshotWriteVersion"
	from (select "archiveUrlIdentity" from history_archive_state_snapshot
		where ${historyArchivePublicSourcePredicateSql}) root
	cross join lateral (${archiveFailureSummarySourceStateSql('root')}) source
	left join history_archive_failure_summary_snapshot snapshot using ("archiveUrlIdentity")
	where source."remoteFailureCount"::numeric > 0
		and (snapshot."lastAttemptAt" is null
			or snapshot."lastAttemptAt" <= now() - interval '5 minutes')
		and (snapshot.summary is null or snapshot."computedAt" is null
			or snapshot."lastErrorCode" is not null
			or snapshot.summary->>'attributionVersion' is distinct from '1'
			or snapshot."sourceRootRevision"::text is distinct from source."rootRevision"
			or snapshot."sourceRetainedRevision" is distinct from source."retainedRevision"
			or snapshot."sourceQueryHash" is distinct from $1::text
			or snapshot."sourceSummaryHash" is distinct from ${archiveFailureSummaryDigestSql('snapshot')}
			or snapshot.summary->>'remoteFailureCount' is distinct from source."remoteFailureCount"
			or snapshot.summary->>'workerIssueCount' is distinct from source."workerIssueCount")
	order by snapshot."lastAttemptAt" nulls first, root."archiveUrlIdentity"
	limit 1
`;

/** Recheck in the write statement: a racing mutation cannot acknowledge newer inputs. */
export const persistArchiveFailureSummarySnapshotSql = `
	with root as (select $1::text as "archiveUrlIdentity"), current_source as materialized (
		select source.* from root
		cross join lateral (${archiveFailureSummarySourceStateSql('root')}) source
	), candidate_summary as (
		select $2::jsonb as summary, $3::timestamptz as "computedAt"
	), accepted as (
		select candidate_summary.*, ${archiveFailureSummaryDigestSql('candidate_summary')}
			as "sourceSummaryHash"
		from current_source cross join candidate_summary
		where $2::jsonb is not null and $4::text is null
			and "rootRevision" = $5::text and "retainedRevision" = $6::text
	)
	insert into history_archive_failure_summary_snapshot as snapshot (
		"archiveUrlIdentity",summary,"computedAt","lastAttemptAt","lastErrorCode",
		"sourceRootRevision","sourceRetainedRevision","sourceQueryHash","sourceSummaryHash"
	)
	select $1, accepted.summary, accepted."computedAt", now(), $4,
		case when accepted.summary is not null then $5::bigint end,
		case when accepted.summary is not null then $6::text end,
		case when accepted.summary is not null then $7::text end,
		accepted."sourceSummaryHash"
	from current_source left join accepted on true
	on conflict ("archiveUrlIdentity") do update set
		summary=coalesce(excluded.summary,snapshot.summary),
		"computedAt"=coalesce(excluded."computedAt",snapshot."computedAt"),
		"sourceRootRevision"=case when excluded.summary is not null
			then excluded."sourceRootRevision" else snapshot."sourceRootRevision" end,
		"sourceRetainedRevision"=case when excluded.summary is not null
			then excluded."sourceRetainedRevision" else snapshot."sourceRetainedRevision" end,
		"sourceQueryHash"=case when excluded.summary is not null
			then excluded."sourceQueryHash" else snapshot."sourceQueryHash" end,
		"sourceSummaryHash"=case when excluded.summary is not null
			then excluded."sourceSummaryHash" else snapshot."sourceSummaryHash" end,
		"lastAttemptAt"=excluded."lastAttemptAt", "lastErrorCode"=excluded."lastErrorCode"
	where $8::text is not null and snapshot.xmin::text = $8::text
`;

export async function refreshNextKnownArchiveFailureSummary(
	database: DataSource,
	load: (
		database: DataSource,
		root: string,
		statementTimeoutMs: typeof knownArchiveFailureSummaryTimeoutMs.refresh
	) => Promise<KnownArchiveFailureSummaryV1> = queryKnownArchiveFailureSummary
): Promise<{ root: string; errorCode: string | null } | null> {
	if (!(await archiveFailureSummarySchema(database.manager)).versionedReady)
		return null;
	const candidates = await database.query<{
		archiveUrlIdentity: string;
		rootRevision: string;
		retainedRevision: string;
		snapshotWriteVersion: string | null;
	}[]>(
		nextArchiveFailureSummaryRootSql,
		[queryFingerprint]
	);
	const candidate = candidates[0];
	if (candidate === undefined) return null;
	if (!isArchiveFailureSummaryRootRevision(candidate.rootRevision))
		throw new Error('Invalid archive failure summary root revision');
	const root = candidate.archiveUrlIdentity;
	let summary: KnownArchiveFailureSummaryV1 | null = null;
	let errorCode: string | null = null;
	try {
		summary = await load(
			database,
			root,
			knownArchiveFailureSummaryTimeoutMs.refresh
		);
		if (summary.computedAt === null || summary.attributionVersion !== 1) {
			summary = null;
			errorCode = 'SUMMARY_REFRESH_FAILED';
		}
	} catch (error: unknown) {
		errorCode = safeErrorCode(error);
	}
	await database.transaction(async (manager) => {
		await manager.query(
			"select set_config('statement_timeout','1500',true),set_config('lock_timeout','250',true)"
		);
		await manager.query(
			persistArchiveFailureSummarySnapshotSql,
			[
				root,
				summary === null ? null : JSON.stringify(summary),
				summary?.computedAt ?? null,
				errorCode,
				candidate.rootRevision,
				candidate.retainedRevision,
				queryFingerprint,
				candidate.snapshotWriteVersion
			]
		);
	});
	return { root, errorCode };
}

/** Called only by the existing authoritative API writer; independent of proof maintenance. */
export function startKnownArchiveFailureSummaryRefresh(
	database: DataSource,
	logger: Pick<Logger, 'error'>
): () => void {
	return startArchiveFailureSummaryRefreshLoop(
		() => refreshNextKnownArchiveFailureSummary(database),
		(error) =>
			logger.error('Archive failure summary refresh deferred', {
				app: 'history-scan-coordinator',
				errorCode: safeErrorCode(error)
			})
	);
}

export function startArchiveFailureSummaryRefreshLoop(
	refresh: () => Promise<{ root: string; errorCode: string | null } | null>,
	report: (error: unknown) => void
): () => void {
	let stopped = false;
	let timer: NodeJS.Timeout | undefined;
	let infrastructureFailureDelay = 300_000;
	const run = async (): Promise<void> => {
		let delay = 30_000;
		try {
			const completed = await refresh();
			if (
				completed?.errorCode != null &&
				isAggregateInfrastructureError(completed.errorCode)
			) {
				// A recorded timeout is still an infrastructure failure: rotating
				// to another root after 1s would keep cold-table reads saturated.
				report({ code: completed.errorCode });
				delay = infrastructureFailureDelay;
				infrastructureFailureDelay = Math.min(delay * 2, 900_000);
			} else {
				infrastructureFailureDelay = 300_000;
				if (completed !== null) {
					delay = 1_000;
					if (completed.errorCode !== null)
						report({ code: completed.errorCode });
				}
			}
		} catch (error: unknown) {
			report(error);
			// No durable attempt could be recorded. Back off this writer rather
			// than repeatedly retrying a failed selector or snapshot write.
			delay = infrastructureFailureDelay;
			infrastructureFailureDelay = Math.min(delay * 2, 900_000);
		}
		if (!stopped) {
			timer = setTimeout(() => void run(), delay);
			timer.unref();
		}
	};
	void run();
	return () => {
		stopped = true;
		if (timer !== undefined) clearTimeout(timer);
	};
}

function isAggregateInfrastructureError(code: string): boolean {
	// PostgreSQL connection/resource/system errors, cancellation, lock contention,
	// transaction retries and server shutdown. These are not archive HTTP statuses.
	return /^(?:08[A-Z0-9]{3}|53[A-Z0-9]{3}|58[A-Z0-9]{3}|57014|55P03|40P01|40001|57P0[123])$/.test(
		code
	);
}

function safeErrorCode(error: unknown): string {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? error.code
			: undefined;
	return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
		? code
		: 'SUMMARY_REFRESH_FAILED';
}
