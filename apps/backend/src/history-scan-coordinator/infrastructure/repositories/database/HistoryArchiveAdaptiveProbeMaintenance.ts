import type { DataSource, EntityManager } from 'typeorm';
import { withBoundedArchiveBrokerMaintenance } from './BoundedArchiveBrokerMaintenance.js';
import {
	completeAdaptiveProbe,
	createAdaptiveProbeState,
	extendAdaptiveProbeState,
	nextAdaptiveProbeCheckpoint,
	parseAdaptiveProbeState,
	type AdaptiveProbeState
} from './HistoryArchiveAdaptiveProbePlanner.js';
import { historyArchiveHostScanAllowedSql } from '../../../domain/history-archive-object/HistoryArchiveScanPolicy.js';
import { activateAdaptiveProbeCheckpointDependencies } from './HistoryArchiveAdaptiveProbeCohort.js';

interface ControlRow {
	readonly archiveUrlIdentity: string;
	readonly archiveUrl: string;
	readonly hostIdentity: string;
	readonly scope: string;
	readonly version: string | number;
	readonly missingCheckpoints: readonly (string | number)[];
	readonly latest: number | string;
	readonly adaptiveProbeState: unknown;
	readonly pendingStatus: string | null;
	readonly pendingHttpStatus: number | null;
}

const numberedScopes = [
	'checkpoint-state',
	'ledger',
	'transactions',
	'results',
	'scp'
];

/** Small control-table scan plus one indexed pending-object/root lookup per row;
 * never enumerates the historical queue and never moves a scan/proof frontier. */
export const adaptiveProbeControlCandidatesSql = `
select control."archiveUrlIdentity", control.scope, control.version,
 control."missingCheckpoints", control."adaptiveProbeState",
 root."archiveUrl", root."hostIdentity",
 least(2147483583, floor((state."currentLedger"+1)::numeric/64)*64-1)::integer latest,
 pending.status as "pendingStatus", pending."httpStatus" as "pendingHttpStatus"
from history_archive_root_failure_control control
join history_archive_state_snapshot state using ("archiveUrlIdentity")
join lateral (select source."archiveUrl",source."hostIdentity",source.status
 from history_archive_object_queue source where source."archiveUrlIdentity"=control."archiveUrlIdentity"
 and source."objectType"='history-archive-state' and source."objectKey"='root' limit 1) root on true
left join lateral (select object.status,object."httpStatus" from history_archive_object_queue object
 where object."remoteId"=case when control."adaptiveProbeState"#>>'{pending,remoteId}' ~*
 '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
 then (control."adaptiveProbeState"#>>'{pending,remoteId}')::uuid end limit 1) pending on true
where control.scope=any($2::text[]) and root.status='verified' and state.status='available'
 and state."currentLedger">=63 and ${historyArchiveHostScanAllowedSql('root')}
 and (control."adaptiveProbeState" is not null or
  (control."failureKind"='missing' and control."consecutiveFailures">=3))
 and (control."adaptiveProbeState"->'pending' is null
  or control."adaptiveProbeState"->'pending'='null'::jsonb
  or pending.status='verified' or (pending.status='failed' and pending."httpStatus" in (404,410)))
order by control."updatedAt",control."archiveUrlIdentity",control.scope limit $1::integer`;

export async function loadHistoryArchiveAdaptiveProbeControls(
	manager: EntityManager,
	limit: number
): Promise<readonly ControlRow[]> {
	if (!Number.isFinite(limit) || limit < 1) return [];
	return manager.query(adaptiveProbeControlCandidatesSql, [
		Math.min(16, Math.floor(limit)),
		numberedScopes
	]) as Promise<readonly ControlRow[]>;
}

/** Release a control's ready/object/root locks before touching the next control.
 * A later rollback never erases earlier committed admission or its wake signal. */
export async function maintainHistoryArchiveAdaptiveProbes(
	dataSource: DataSource,
	limit: number,
	reportDeferred?: (code: string) => void
): Promise<{ admitted: number; deferred: boolean }> {
	const rows = await withBoundedArchiveBrokerMaintenance(
		dataSource,
		(manager) => loadHistoryArchiveAdaptiveProbeControls(manager, limit),
		null,
		reportDeferred
	).catch(() => null);
	if (rows === null) return { admitted: 0, deferred: true };
	let admitted = 0;
	for (const row of rows) {
		const result = await withBoundedArchiveBrokerMaintenance(
			dataSource,
			(manager) => maintainHistoryArchiveAdaptiveProbeControl(manager, row),
			-1,
			reportDeferred
		).catch(() => -1);
		if (result < 0) return { admitted, deferred: true };
		admitted += result;
	}
	return { admitted, deferred: false };
}

/** One control only; optimistic version CAS fences the earlier candidate snapshot. */
export async function maintainHistoryArchiveAdaptiveProbeControl(
	manager: EntityManager,
	row: ControlRow
): Promise<number> {
	let state =
		row.adaptiveProbeState === null
			? createAdaptiveProbeState(
					row.missingCheckpoints.map(Number),
					Number(row.latest)
				)
			: parseAdaptiveProbeState(row.adaptiveProbeState);
	if (state === null) return 0; // Fail closed on corrupt/unknown state versions.
	await manager.query('savepoint adaptive_probe_root');
	if (state.pending !== null) {
		if (row.pendingStatus === 'verified') {
			if (row.scope === 'checkpoint-state') {
				const activation = await activateAdaptiveProbeCheckpointDependencies(
					manager,
					row.archiveUrlIdentity,
					state.pending.checkpoint
				);
				if (!activation.materialized) {
					await manager.query('release savepoint adaptive_probe_root');
					return 0;
				}
			}
		} else if (
			row.pendingStatus !== 'failed' ||
			(row.pendingHttpStatus !== 404 && row.pendingHttpStatus !== 410)
		) {
			await manager.query('release savepoint adaptive_probe_root');
			return 0;
		}
		state = completeAdaptiveProbe(state);
	}
	state = extendAdaptiveProbeState(state, Number(row.latest));
	const checkpoint = nextAdaptiveProbeCheckpoint(state);
	if (
		checkpoint === null &&
		JSON.stringify(state) === JSON.stringify(row.adaptiveProbeState)
	) {
		await manager.query('release savepoint adaptive_probe_root');
		return 0;
	}
	let nextState: AdaptiveProbeState = state;
	let queued = false;
	if (checkpoint !== null) {
		const object = await ensureProbeObject(manager, row, checkpoint);
		if (!object) {
			await manager.query('rollback to savepoint adaptive_probe_root');
			await manager.query('release savepoint adaptive_probe_root');
			return 0;
		}
		nextState = {
			...state,
			pending: { checkpoint, remoteId: object.remoteId }
		};
		queued = object.status === 'pending';
	}
	const updated = (await manager.query(
		`update history_archive_root_failure_control
 set "adaptiveProbeState"=$4::jsonb,"nextProbeCheckpoint"=$5::bigint,
 version=version+1,"updatedAt"=now()
 where "archiveUrlIdentity"=$1 and scope=$2 and version=$3::bigint
 returning version`,
		[
			row.archiveUrlIdentity,
			row.scope,
			row.version,
			JSON.stringify(nextState),
			checkpoint
		]
	)) as readonly unknown[];
	if (updated.length === 0)
		await manager.query('rollback to savepoint adaptive_probe_root');
	await manager.query('release savepoint adaptive_probe_root');
	return updated.length > 0 && queued ? 1 : 0;
}

async function ensureProbeObject(
	manager: EntityManager,
	row: ControlRow,
	checkpoint: number
): Promise<{ readonly remoteId: string; readonly status: string } | null> {
	const hex = checkpoint.toString(16).padStart(8, '0');
	const category = row.scope === 'checkpoint-state' ? 'history' : row.scope;
	const extension = row.scope === 'checkpoint-state' ? 'json' : 'xdr.gz';
	const objectKey = `${row.scope}:${hex}`;
	const url = `${row.archiveUrl.replace(/\/+$/, '')}/${category}/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex.slice(4, 6)}/${category}-${hex}.${extension}`;
	await manager.query(
		`insert into history_archive_object_queue (
 "remoteId","archiveUrl","archiveUrlIdentity","hostIdentity","objectType","objectKey",
 "objectOrder","objectUrl",status,"checkpointLedger","dependencyReady",
 "executionDisposition","executionReason","executionDispositionAt")
 values(gen_random_uuid(),$1,$2,$3,$4,$5,10,$6,'pending',$7,true,'executable','adaptive-missing-probe',now())
 on conflict("archiveUrlIdentity","objectType","objectKey") do nothing`,
		[
			row.archiveUrl,
			row.archiveUrlIdentity,
			row.hostIdentity,
			row.scope,
			objectKey,
			url,
			checkpoint
		]
	);
	const [object] = (await manager.query(
		`select "remoteId",status,"executionDisposition" from history_archive_object_queue
 where "archiveUrlIdentity"=$1 and "objectType"=$2 and "objectKey"=$3`,
		[row.archiveUrlIdentity, row.scope, objectKey]
	)) as readonly {
		readonly remoteId: string;
		readonly status: string;
		readonly executionDisposition: string | null;
	}[];
	if (object?.executionDisposition === 'superseded') return null;
	if (!object || object.status !== 'pending') return object ?? null;
	// Lock ready before touching an existing pending object, same order as completion.
	await manager.query(
		`insert into history_archive_object_ready
 ("objectRemoteId","archiveUrlIdentity",priority,"availableAt","createdAt","updatedAt")
 values($1::uuid,$2,2,now(),now(),now()) on conflict("objectRemoteId") do nothing`,
		[object.remoteId, row.archiveUrlIdentity]
	);
	await manager.query(
		`select "objectRemoteId" from history_archive_object_ready
 where "objectRemoteId"=$1::uuid for update`,
		[object.remoteId]
	);
	await manager.query(
		`update history_archive_object_queue set "dependencyReady"=true,
 "executionDisposition"='executable',"executionReason"='adaptive-missing-probe',
 "executionDispositionAt"=now(),"updatedAt"=now()
 where "remoteId"=$1::uuid and status='pending'`,
		[object.remoteId]
	);
	return object;
}
