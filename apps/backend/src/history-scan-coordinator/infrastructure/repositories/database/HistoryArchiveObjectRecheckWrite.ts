import type { EntityManager, Repository } from 'typeorm';
import type { HistoryArchiveObjectRecheckBlockedReasonV1 } from 'shared';
import type { HistoryArchiveObject } from '../../../domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectRecheckDecision } from '../../../domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	isHistoryArchiveManualRemoteRetryFailure,
	isHistoryArchiveProofGatedMissingFailure,
	isHistoryArchiveRepairableIntegrityFailure
} from '../../../domain/history-archive-object/HistoryArchiveRepairCandidateFailure.js';

interface RecheckTargetRow {
	readonly archiveUrlIdentity: string;
	readonly dependencyReady: boolean | null;
	readonly eligibleAt: Date | string;
	readonly evidenceUpdatedAt: Date | string;
	readonly executionDisposition: string | null;
	readonly errorMessage: string | null;
	readonly errorType: string | null;
	readonly failureChannel: string | null;
	readonly hostIdentity: string;
	readonly httpStatus: number | null;
	readonly remoteId: string;
	readonly requestedAt: Date | string;
	readonly status: string;
	readonly transitionPending: boolean;
}

interface ReadyObjectRow {
	readonly objectRemoteId: string;
}

interface HostBackoffRow {
	readonly blockedUntil: Date | string;
}

const selectTargetSql = `
	select
		object."remoteId",
		object."archiveUrlIdentity",
		object."hostIdentity",
		object.status,
		object."failureChannel",
		object."dependencyReady",
		object."executionDisposition",
		object."errorMessage",
		object."errorType",
		object."httpStatus",
		object."updatedAt" as "evidenceUpdatedAt",
		coalesce(
			object."nextAttemptAt",
			object."updatedAt" + interval '1 hour'
		) as "eligibleAt",
		(
			object."transitionEffectsRequiredAt" is not null
			and object."transitionEffectsCompletedAt" is null
		) as "transitionPending",
		now() as "requestedAt"
	from "history_archive_object_queue" object
	where object."remoteId" = $1
	for update
`;

const selectHostBackoffSql = `
	select throttle."blockedUntil"
	from "history_archive_object_host_throttle" throttle
	where throttle."hostIdentity" = $1
	for share
`;

const selectReadyObjectSql = `
	select ready."objectRemoteId"
	from "history_archive_object_ready" ready
	where ready."objectRemoteId" = $1
	for update
`;

const insertReadyObjectSql = `
	insert into "history_archive_object_ready" (
		"objectRemoteId", "archiveUrlIdentity", priority, "availableAt", "dispatchToken",
		"createdAt", "updatedAt"
	) values ($1, $2, $3, $4, gen_random_uuid(), $4, $4)
	on conflict do nothing
	returning "objectRemoteId"
`;

export async function requestHistoryArchiveObjectRecheck(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	minimumEvidenceUpdatedAt?: Date
): Promise<HistoryArchiveObjectRecheckDecision | null> {
	return await repository.manager.transaction(async (manager) => {
		const [target] = (await manager.query(selectTargetSql, [
			remoteId
		])) as readonly RecheckTargetRow[];
		if (target === undefined) return null;

		const requestedAt = requireDate(target.requestedAt, 'requestedAt');
		const eligibleAt = requireDate(target.eligibleAt, 'eligibleAt');
		const evidenceUpdatedAt = requireDate(
			target.evidenceUpdatedAt,
			'evidenceUpdatedAt'
		);
		if (
			minimumEvidenceUpdatedAt !== undefined &&
			evidenceUpdatedAt.getTime() !== minimumEvidenceUpdatedAt.getTime()
		) {
			return blocked(target.remoteId, 'evidence-revision-changed');
		}
		const ineligible = getIneligibleReason(target);
		if (ineligible !== null) {
			return blocked(target.remoteId, ineligible);
		}
		if (eligibleAt > requestedAt) {
			return {
				blockedUntil: null,
				eligibleAt,
				reason: 'retry-window',
				remoteId: target.remoteId,
				state: 'not-yet-eligible'
			};
		}

		const [hostBackoff] = (await manager.query(selectHostBackoffSql, [
			target.hostIdentity
		])) as readonly HostBackoffRow[];
		const blockedUntil =
			hostBackoff === undefined
				? null
				: requireDate(hostBackoff.blockedUntil, 'blockedUntil');
		if (blockedUntil !== null && blockedUntil > requestedAt) {
			return blocked(target.remoteId, 'host-backoff', eligibleAt, blockedUntil);
		}

		const ready = await findReadyObject(manager, target.remoteId);
		if (ready?.objectRemoteId === target.remoteId) {
			return alreadyQueued(target.remoteId, eligibleAt);
		}
		if (ready !== undefined) {
			return blocked(
				target.remoteId,
				'archive-work-already-queued',
				eligibleAt
			);
		}

		const inserted = (await manager.query(insertReadyObjectSql, [
			target.remoteId,
			target.archiveUrlIdentity,
			2,
			requestedAt
		])) as readonly ReadyObjectRow[];
		if (inserted[0]?.objectRemoteId === target.remoteId) {
			return {
				blockedUntil: null,
				eligibleAt,
				reason: 'eligible-remote-failure',
				remoteId: target.remoteId,
				state: 'queued'
			};
		}

		const winner = await findReadyObject(manager, target.remoteId);
		if (winner?.objectRemoteId === target.remoteId) {
			return alreadyQueued(target.remoteId, eligibleAt);
		}
		return blocked(target.remoteId, 'archive-work-already-queued', eligibleAt);
	});
}

function getIneligibleReason(
	target: RecheckTargetRow
): HistoryArchiveObjectRecheckBlockedReasonV1 | null {
	if (target.status === 'verified') return 'verified-object';
	if (target.status !== 'failed') return 'object-not-failed';
	const failureChannel = target.failureChannel ?? 'archive_evidence';
	const repairCandidateLane =
		((failureChannel === 'archive_availability' ||
			failureChannel === 'archive_evidence') &&
			isHistoryArchiveProofGatedMissingFailure(target)) ||
		((failureChannel === 'archive_availability' ||
			failureChannel === 'archive_evidence') &&
			isHistoryArchiveManualRemoteRetryFailure(target)) ||
		(failureChannel === 'archive_evidence' &&
			isHistoryArchiveRepairableIntegrityFailure(target));
	if (!repairCandidateLane) {
		if (
			failureChannel !== 'archive_availability' &&
			failureChannel !== 'archive_evidence'
		) {
			return 'non-remote-evidence-failure';
		}
		return 'non-repair-candidate-failure';
	}
	if (target.executionDisposition !== 'executable') {
		return 'object-not-executable';
	}
	if (target.dependencyReady !== true) return 'dependency-not-ready';
	if (target.transitionPending) return 'transition-effects-pending';
	return null;
}

async function findReadyObject(
	manager: EntityManager,
	remoteId: string
): Promise<ReadyObjectRow | undefined> {
	const rows = (await manager.query(selectReadyObjectSql, [
		remoteId
	])) as readonly ReadyObjectRow[];
	return rows[0];
}

function alreadyQueued(
	remoteId: string,
	eligibleAt: Date
): HistoryArchiveObjectRecheckDecision {
	return {
		blockedUntil: null,
		eligibleAt,
		reason: 'already-in-ready-queue',
		remoteId,
		state: 'already-queued'
	};
}

function blocked(
	remoteId: string,
	reason: HistoryArchiveObjectRecheckBlockedReasonV1,
	eligibleAt: Date | null = null,
	blockedUntil: Date | null = null
): HistoryArchiveObjectRecheckDecision {
	return { blockedUntil, eligibleAt, reason, remoteId, state: 'blocked' };
}

function requireDate(value: Date | string, field: string): Date {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) {
		throw new Error(`History archive object recheck has invalid ${field}`);
	}
	return date;
}
