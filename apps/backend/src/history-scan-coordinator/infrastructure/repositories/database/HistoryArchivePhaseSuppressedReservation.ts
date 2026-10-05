import type { EntityManager } from 'typeorm';
import type { ArchiveBrokerExecutionSnapshot } from '../../cli/archive-broker/ArchiveBrokerExecutionSnapshot.js';
import {
	getHistoryArchiveRetryPhase,
	historyArchiveFirstPassAllowedSql
} from './HistoryArchiveFirstPassPolicy.js';

interface PublishedReservation {
	readonly remoteId: string;
	readonly executionId: string;
	readonly claimAttempt: number;
	readonly publishedAt: string;
}
const forbidden = `not ${historyArchiveFirstPassAllowedSql('object', 'ready', 'first-pass')}`;

/** Called under the dispatcher reservation mutex, before this same dispatch
 * loop can publish. Current first-pass reservation AND replay both reject these
 * tokens; the stable broker snapshot fences an already queued publication.
 * Never reclaim eligible/in-flight work merely because a timestamp is old. */
export async function reconcileHistoryArchivePhaseSuppressedReservations(
	manager: EntityManager,
	publishedBefore: Date,
	limit: number,
	readSnapshot: () => Promise<ArchiveBrokerExecutionSnapshot | null>
): Promise<number> {
	if (getHistoryArchiveRetryPhase() !== 'first-pass' || limit < 1) return 0;
	const candidates = (await manager.query(
		`
		with published_window as materialized (
			select "objectRemoteId" from history_archive_object_ready
			where "publishedAt" <= $1::timestamptz
			order by "publishedAt","objectRemoteId" limit $2::integer
		)
		select ready."objectRemoteId" as "remoteId", ready."dispatchToken" as "executionId",
			ready."claimAttempt", ready."publishedAt"::text as "publishedAt"
		from published_window join history_archive_object_ready ready using ("objectRemoteId")
		join history_archive_object_queue object on object."remoteId"=ready."objectRemoteId"
		where ready."publishedAt" <= $1::timestamptz
			and ready."dispatchToken" is not null
			and ready."claimAttempt"=object.attempts+1
			and object.status in ('pending','failed') and ${forbidden}
		order by ready."publishedAt",ready."objectRemoteId"
		for update of ready skip locked
	`,
		[publishedBefore, Math.min(240, Math.floor(limit))]
	)) as PublishedReservation[];
	if (candidates.length === 0) return 0;
	const snapshot = await readSnapshot();
	if (snapshot === null) return 0;
	const absent = candidates.filter(
		(candidate) => !snapshot.executionIds.has(candidate.executionId)
	);
	if (absent.length === 0 || !(await snapshot.confirmUnchanged())) return 0;
	const [updated] = (await manager.query(
		`
		with reclaimed as (update history_archive_object_ready ready set "publishedAt"=null,
			"dispatchToken"=null,"claimAttempt"=null,"recheckRequestedAt"=null,"updatedAt"=now()
		from jsonb_to_recordset($1::jsonb) input("remoteId" uuid,"executionId" uuid,
			"claimAttempt" integer,"publishedAt" timestamptz),history_archive_object_queue object
		where ready."objectRemoteId"=input."remoteId" and object."remoteId"=input."remoteId"
			and ready."dispatchToken"=input."executionId"
			and ready."claimAttempt"=input."claimAttempt"
			and ready."publishedAt"=input."publishedAt"
			and object.attempts+1=input."claimAttempt" and object.status in ('pending','failed')
			and ${forbidden}
		returning ready."objectRemoteId") select count(*)::integer as count from reclaimed
	`,
		[JSON.stringify(absent)]
	)) as { count: number }[];
	return updated?.count ?? 0;
}
