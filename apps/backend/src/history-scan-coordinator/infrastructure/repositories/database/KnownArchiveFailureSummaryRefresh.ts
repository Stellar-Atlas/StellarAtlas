import type { DataSource } from 'typeorm';
import type { Logger } from 'logger';
import type { KnownArchiveFailureSummaryV1 } from 'shared';
import { historyArchivePublicSourcePredicateSql } from './HistoryArchivePublicSourceScopeSql.js';
import { queryKnownArchiveFailureSummary } from './KnownArchiveFailureSummaryQuery.js';

/** Only trusted current roots with remote findings are grouped. Zero uses existing rollups. */
export const nextArchiveFailureSummaryRootSql = `
	select root."archiveUrlIdentity"
	from (select "archiveUrlIdentity" from history_archive_state_snapshot
		where ${historyArchivePublicSourcePredicateSql}) root
	left join history_archive_evidence_root_summary evidence using ("archiveUrlIdentity")
	left join history_archive_failure_summary_snapshot snapshot using ("archiveUrlIdentity")
	where coalesce(evidence."remoteFailureObjects",0) + coalesce((
		select sum("retainedObjects") from history_archive_retained_remote_summary retained
		where retained."archiveUrlIdentity" = root."archiveUrlIdentity"),0) > 0
		and (snapshot."lastAttemptAt" is null or snapshot."lastAttemptAt" <= now() -
			case when snapshot."lastErrorCode" is null then interval '5 minutes' else interval '30 seconds' end)
	order by snapshot."lastAttemptAt" nulls first, root."archiveUrlIdentity"
	limit 1
`;

export async function refreshNextKnownArchiveFailureSummary(
	database: DataSource,
	load: (
		database: DataSource,
		root: string
	) => Promise<KnownArchiveFailureSummaryV1> = queryKnownArchiveFailureSummary
): Promise<{ root: string; errorCode: string | null } | null> {
	const candidates = await database.query<{ archiveUrlIdentity: string }[]>(
		nextArchiveFailureSummaryRootSql
	);
	const root = candidates[0]?.archiveUrlIdentity;
	if (root === undefined) return null;
	let summary: KnownArchiveFailureSummaryV1 | null = null;
	let errorCode: string | null = null;
	try {
		summary = await load(database, root);
	} catch (error: unknown) {
		errorCode = safeErrorCode(error);
	}
	await database.transaction(async (manager) => {
		await manager.query(
			"select set_config('statement_timeout','1500',true),set_config('lock_timeout','250',true)"
		);
		await manager.query(
			`insert into history_archive_failure_summary_snapshot
			("archiveUrlIdentity",summary,"computedAt","lastAttemptAt","lastErrorCode")
			values ($1,$2::jsonb,$3::timestamptz,now(),$4)
			on conflict ("archiveUrlIdentity") do update set
				summary=coalesce(excluded.summary,history_archive_failure_summary_snapshot.summary),
				"computedAt"=coalesce(excluded."computedAt",history_archive_failure_summary_snapshot."computedAt"),
				"lastAttemptAt"=excluded."lastAttemptAt", "lastErrorCode"=excluded."lastErrorCode"`,
			[
				root,
				summary === null ? null : JSON.stringify(summary),
				summary?.computedAt ?? null,
				errorCode
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
	const run = async (): Promise<void> => {
		let delay = 30_000;
		try {
			const completed = await refresh();
			if (completed !== null) {
				delay = 1_000;
				if (completed.errorCode !== null) report({ code: completed.errorCode });
			}
		} catch (error: unknown) {
			report(error);
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

function safeErrorCode(error: unknown): string {
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? error.code
			: undefined;
	return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code)
		? code
		: 'SUMMARY_REFRESH_FAILED';
}
