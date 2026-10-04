import type { EntityManager } from 'typeorm';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { historyArchiveInconclusiveTransportFailureSql } from './HistoryArchiveFailureAttributionSql.js';
import { notifyHistoryArchiveReadyWork } from './HistoryArchiveObjectReadyQueue.js';

/** A singleton cursor, not another per-object job/attempt log. */
export const historyArchiveTransientSourceRetrySchemaSql = `
	create table if not exists history_archive_transient_source_retry_sweep (
		singleton boolean primary key default true check (singleton),
		"sweepStartedAt" timestamptz not null default now(),
		phase text not null default 'current' check (phase in ('current', 'retained')),
		"objectOrder" integer, "objectKey" text, "archiveUrlIdentity" text,
		"retainedRemoteId" uuid,
		"nextSweepAt" timestamptz not null default now()
	)
`;

interface SweepState {
	readonly sweepStartedAt: Date;
	readonly phase: 'current' | 'retained';
	readonly objectOrder: number | null;
	readonly objectKey: string | null;
	readonly archiveUrlIdentity: string | null;
	readonly retainedRemoteId: string | null;
	readonly nextSweepAt: Date;
}
interface Candidate {
	readonly remoteId: string;
	readonly archiveUrlIdentity: string;
	readonly objectOrder: number;
	readonly objectKey: string;
}
interface CandidateBatch {
	readonly candidates: readonly Candidate[];
	readonly last: Candidate | null;
}

const dailyDueSql = `
	(object."lastClaimedAt" is null or object."lastClaimedAt" < $1::timestamptz)
	and object."dependencyReady"
	and ${historyArchiveHostScanAllowedSql('object')}
	and object."executionDisposition" <> 'superseded'
	and (object."transitionEffectsRequiredAt" is null
		or object."transitionEffectsCompletedAt" is not null)
`;

export function historyArchiveTransientSourceFailureSql(alias: string): string {
	const inconclusive = historyArchiveInconclusiveTransportFailureSql(alias);
	return `(coalesce(${alias}."httpStatus" between 500 and 599, false) or ${inconclusive})`;
}

/** A retained transport failure must never override a newer definitive HTTP result. */
export function historyArchiveAllowsAutomaticSourceRetrySql(
	alias: string
): string {
	if (!/^[a-z_][a-z0-9_]*$/i.test(alias))
		throw new Error('Invalid retry SQL alias');
	return `not coalesce(${alias}."httpStatus" between 400 and 499
		and ${alias}."httpStatus" not in (408, 425, 429), false)`;
}

export const currentTransientSourceFailureSql = `(object.status = 'failed'
	and ${historyArchiveTransientSourceFailureSql('object')})`;

// LIMIT precedes HTTP filtering. The keyset/order exactly follows the existing
// (status, objectOrder, objectKey, archiveUrlIdentity) index, never the 214M queue.
export const currentTransientSourceRetryCandidatesSql = `
	with scanned as materialized (
		select object."remoteId", object."archiveUrlIdentity", object."hostIdentity", object."objectOrder",
			object."objectKey", object.status, object."httpStatus", object."lastClaimedAt",
			object."errorType", object."errorMessage", object."executionDisposition",
			object."dependencyReady", object."transitionEffectsRequiredAt",
			object."transitionEffectsCompletedAt"
		from history_archive_object_queue object
		where object.status = 'failed'
			and ($2::integer is null or
				(object."objectOrder", object."objectKey", object."archiveUrlIdentity")
				> ($2::integer, $3::text, $4::text))
		order by object."objectOrder", object."objectKey", object."archiveUrlIdentity"
		limit 4096
	), candidates as materialized (
		select object."remoteId", object."archiveUrlIdentity", object."objectOrder", object."objectKey"
		from scanned object where ${currentTransientSourceFailureSql}
			and ${dailyDueSql}
		order by object."objectOrder", object."objectKey", object."archiveUrlIdentity"
		limit $5::integer
	)
	select coalesce((select jsonb_agg(candidate) from candidates candidate), '[]') as candidates,
		(select to_jsonb(last_row) from (
			select "remoteId", "archiveUrlIdentity", "objectOrder", "objectKey"
			from scanned order by "objectOrder" desc, "objectKey" desc, "archiveUrlIdentity" desc limit 1
		) last_row) as last
`;

// This sparse projection is maintained by the existing statement-level retention
// trigger, and resolved only by a fenced same-source verified completion.
export const retainedTransientSourceRetryCandidatesSql = `
	with scanned as materialized (
		select finding."objectRemoteId", finding."httpStatus", finding."retainedOnly",
			finding."errorType", finding."errorMessage"
		from history_archive_retained_remote_finding finding
		where ($2::uuid is null or finding."objectRemoteId" > $2::uuid)
		order by finding."objectRemoteId" limit 4096
	), candidates as materialized (
		select object."remoteId", object."archiveUrlIdentity", object."objectOrder", object."objectKey"
		from scanned finding join history_archive_object_queue object
			on object."remoteId" = finding."objectRemoteId"
		where finding."retainedOnly" and ${historyArchiveTransientSourceFailureSql('finding')}
			and ${historyArchiveAllowsAutomaticSourceRetrySql('object')}
			and object.status <> 'scanning' and ${dailyDueSql}
		order by object."remoteId" limit $3::integer
	)
	select coalesce((select jsonb_agg(candidate) from candidates candidate), '[]') as candidates,
		(select jsonb_build_object('remoteId', "objectRemoteId")
			from scanned order by "objectRemoteId" desc limit 1) as last
`;

export const admitTransientSourceRetriesSql = `
	with candidates as materialized (
		select * from jsonb_to_recordset($1::jsonb)
			as candidate("remoteId" uuid, "archiveUrlIdentity" text)
	), ready_lockable as materialized (
		select ready."objectRemoteId" from history_archive_object_ready ready
		join candidates on candidates."remoteId" = ready."objectRemoteId"
		where ready."publishedAt" is null and ready."dispatchToken" is null
			and ready."claimAttempt" is null
		order by ready."objectRemoteId" for update of ready skip locked
	), eligible as materialized (
		select object."remoteId", object."archiveUrlIdentity"
		from candidates join history_archive_object_queue object
			on object."remoteId" = candidates."remoteId"
		where object.status <> 'scanning' and ${dailyDueSql.replaceAll('$1', '$2')}
			and ${historyArchiveAllowsAutomaticSourceRetrySql('object')}
			and (${currentTransientSourceFailureSql}
				or exists (select 1 from history_archive_retained_remote_finding finding
					where finding."objectRemoteId" = object."remoteId"
						and finding."retainedOnly" and ${historyArchiveTransientSourceFailureSql('finding')}))
	), promoted as (
		update history_archive_object_ready ready set priority = 0,
			"availableAt" = now(), "dispatchToken" = gen_random_uuid(), "updatedAt" = now()
		from eligible join ready_lockable on ready_lockable."objectRemoteId" = eligible."remoteId"
		where ready."objectRemoteId" = ready_lockable."objectRemoteId"
		returning ready."objectRemoteId"
	), admitted as (
		insert into history_archive_object_ready (
			"objectRemoteId", "archiveUrlIdentity", priority, "availableAt",
			"dispatchToken", "createdAt", "updatedAt"
		)
		select "remoteId", "archiveUrlIdentity", 0, now(), gen_random_uuid(), now(), now()
		from eligible where not exists (
			select 1 from history_archive_object_ready ready
			where ready."objectRemoteId" = eligible."remoteId"
		)
		order by "remoteId" on conflict ("objectRemoteId") do nothing
		returning "objectRemoteId"
	)
	select ((select count(*) from admitted) + (select count(*) from promoted))::integer as count
`;

/** Caller provides one bounded transaction; cursor and admission commit together. */
export async function admitDailyTransientSourceRetries(
	manager: EntityManager,
	limit: number,
	deferUntil?: (time: number) => void
): Promise<number> {
	if (limit < 1) return 0;
	await manager.query(`insert into history_archive_transient_source_retry_sweep
		(singleton) values (true) on conflict do nothing`);
	const [state] = (await manager.query(`select *
		from history_archive_transient_source_retry_sweep
		where singleton for update skip locked`)) as SweepState[];
	if (!state) return 0;
	if (state.nextSweepAt.getTime() > Date.now()) {
		deferUntil?.(state.nextSweepAt.getTime());
		return 0;
	}
	const [waiting] =
		(await manager.query(`select count(*)::integer as count from (
		select 1 from history_archive_object_ready where priority = 0
			and "publishedAt" is null and "dispatchToken" is not null limit 128
	) queued`)) as { readonly count: number }[];
	const capacity = Math.min(128 - (waiting?.count ?? 0), Math.floor(limit));
	if (capacity < 1) return 0;
	const [batch] = (await manager.query(
		state.phase === 'current'
			? currentTransientSourceRetryCandidatesSql
			: retainedTransientSourceRetryCandidatesSql,
		state.phase === 'current'
			? [
					state.sweepStartedAt,
					state.objectOrder,
					state.objectKey,
					state.archiveUrlIdentity,
					capacity + 1
				]
			: [state.sweepStartedAt, state.retainedRemoteId, capacity + 1]
	)) as CandidateBatch[];
	if (!batch) throw new Error('Missing transient source retry batch');
	const candidates = batch.candidates.slice(0, capacity);
	// Do not skip excess due work when ready admission capacity is smaller than a page.
	const cursor =
		batch.candidates.length > capacity ? candidates.at(-1)! : batch.last;
	const [admitted] = (await manager.query(admitTransientSourceRetriesSql, [
		JSON.stringify(candidates),
		state.sweepStartedAt
	])) as { readonly count: number }[];
	const finished = cursor === null;
	const completedSweep = finished && state.phase === 'retained';
	const [advanced] = (await manager.query(
		`update history_archive_transient_source_retry_sweep set
		phase = $1, "objectOrder" = $2, "objectKey" = $3,
		"archiveUrlIdentity" = $4, "retainedRemoteId" = $5,
		"nextSweepAt" = case when $6 then greatest("sweepStartedAt" + interval '24 hours', now()) else now() end,
		"sweepStartedAt" = case when $6 then greatest("sweepStartedAt" + interval '24 hours', now()) else "sweepStartedAt" end
		where singleton returning "nextSweepAt"`,
		[
			finished ? (completedSweep ? 'current' : 'retained') : state.phase,
			!finished && state.phase === 'current' ? cursor.objectOrder : null,
			!finished && state.phase === 'current' ? cursor.objectKey : null,
			!finished && state.phase === 'current' ? cursor.archiveUrlIdentity : null,
			!finished && state.phase === 'retained' ? cursor.remoteId : null,
			completedSweep
		]
	)) as { readonly nextSweepAt: Date }[];
	if (completedSweep && advanced) deferUntil?.(advanced.nextSweepAt.getTime());
	const count = admitted?.count ?? 0;
	if (count > 0) await notifyHistoryArchiveReadyWork(manager);
	return count;
}
