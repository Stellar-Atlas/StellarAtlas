import type { Repository } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectProgressUpdate,
	HistoryArchiveObjectTransitionCompletion,
	HistoryArchiveObjectVerificationUpdate
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import {
	createObjectFromRow,
	extractRows,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';
import { hasPostgresSqlState } from './PostgresError.js';
import {
	prepareHistoryArchiveContentCompletions,
	type PreparedHistoryArchiveContentCompletion,
	recordHistoryArchiveContentEvidenceBatch
} from './HistoryArchiveContentReuseWrite.js';
import { lockHistoryArchiveObjectRootTransition } from './HistoryArchiveRootTransitionLock.js';

export async function markHistoryArchiveObjectVerified(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	progress: HistoryArchiveObjectProgressUpdate
): Promise<boolean> {
	return (
		await markHistoryArchiveObjectsVerified(repository, [
			{ progress, remoteId }
		])
	).has(remoteId);
}

export async function markHistoryArchiveObjectsVerified(
	repository: Repository<HistoryArchiveObject>,
	updates: readonly HistoryArchiveObjectVerificationUpdate[]
): Promise<ReadonlySet<string>> {
	const unique = [
		...new Map(updates.map((update) => [update.remoteId, update])).values()
	].filter(
		(update) =>
			update.progress.scheduler !== 'broker' ||
			update.progress.executionId !== undefined
	);
	if (unique.length === 0) return new Set();

	return await repository.manager.transaction(async (manager) => {
		const preparedUpdates: readonly PreparedHistoryArchiveContentCompletion[] =
			await prepareHistoryArchiveContentCompletions(manager, unique);

		const payload = JSON.stringify(
			preparedUpdates.map(({ prepared, remoteId }) => {
				const progress = prepared.progress;
				return {
					archiveMetadata: progress.archiveMetadata ?? null,
					bytesDownloaded: progress.bytesDownloaded ?? null,
					claimAttempt: progress.claimAttempt,
					executionId: progress.executionId ?? null,
					hasBytesDownloaded: progress.bytesDownloaded !== undefined,
					hasVerificationFacts: progress.verificationFacts !== undefined,
					remoteId,
					scheduler: progress.scheduler ?? 'legacy',
					verificationFacts: progress.verificationFacts ?? null,
					workerStage: progress.workerStage ?? null
				};
			})
		);
		const rows = (await manager.query(historyArchiveObjectVerifiedBatchSql, [
			payload
		])) as readonly { readonly remoteId: string }[];
		const verified = new Set(rows.map((row) => row.remoteId));

		await recordHistoryArchiveContentEvidenceBatch(
			manager,
			preparedUpdates.filter((update) => verified.has(update.remoteId))
		);
		return verified;
	});
}

export async function touchHistoryArchiveObjectClaim(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	claimAttempt: number
): Promise<boolean> {
	const rows = extractRows(
		(await repository.manager.query(historyArchiveObjectHeartbeatSql, [
			remoteId,
			claimAttempt
		])) as RawObjectQueryResult
	);
	return rows.length > 0;
}

export async function releaseHistoryArchiveObject(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	claimAttempt: number
): Promise<boolean> {
	return await repository.manager.transaction(async (manager) => {
		await lockHistoryArchiveObjectRootTransition(manager, remoteId);
		const result = await manager
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set({
				claimedAt: null,
				claimedByCommunityScannerId: null,
				nextAttemptAt: null,
				status: 'pending',
				updatedAt: () => 'now()',
				workerStage: null
			})
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', { claimAttempt })
			.execute();
		if ((result.affected ?? 0) === 0) return false;

		await clearClaimSlot(manager.query.bind(manager), remoteId, claimAttempt);
		return true;
	});
}

export async function releaseStaleHistoryArchiveObjects(
	repository: Repository<HistoryArchiveObject>,
	before: Date,
	limit: number
): Promise<readonly HistoryArchiveObject[]> {
	try {
		return await repository.manager.transaction(async (manager) => {
			await manager.query(staleReleaseSettingsSql);
			const rows = extractRows(
				(await manager.query(historyArchiveObjectStaleReleaseSql, [
					before,
					normalizeLimit(limit)
				])) as RawObjectQueryResult
			);
			const objects = rows.map(createObjectFromRow);
			return objects;
		});
	} catch (error) {
		if (hasPostgresSqlState(error, '55P03')) return [];
		throw error;
	}
}

export async function markHistoryArchiveTransitionEffectsCompleted(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	claimAttempt: number,
	status: 'failed' | 'verified'
): Promise<boolean> {
	return await repository.manager.transaction(async (manager) => {
		await lockHistoryArchiveObjectRootTransition(manager, remoteId);
		const result = await manager
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set({
				transitionEffectsCompletedAt: () => 'now()',
				updatedAt: () => 'now()'
			})
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status })
			.andWhere('attempts = :claimAttempt', { claimAttempt })
			.andWhere('"transitionEffectsRequiredAt" is not null')
			.andWhere('"transitionEffectsCompletedAt" is null')
			.execute();
		if ((result.affected ?? 0) === 0) return false;
		return true;
	});
}

export async function markHistoryArchiveTransitionEffectsCompletedBatch(
	repository: Repository<HistoryArchiveObject>,
	updates: readonly HistoryArchiveObjectTransitionCompletion[]
): Promise<ReadonlySet<string>> {
	const unique = [
		...new Map(
			updates.map((update) => [
				`${update.remoteId}:${update.claimAttempt}:${update.status}`,
				update
			])
		).values()
	];
	if (unique.length === 0) return new Set();

	return await repository.manager.transaction(async (manager) => {
		const rows = extractRows(
			(await manager.query(
				`
					with input as (
						select *
						from jsonb_to_recordset($1::jsonb) as item(
							"remoteId" uuid,
							"claimAttempt" integer,
							status text
						)
					)
					update "history_archive_object_queue" object
					set "transitionEffectsCompletedAt" = now(),
						"updatedAt" = now()
					from input
					where object."remoteId" = input."remoteId"
					  and object.status = input.status
					  and object.attempts = input."claimAttempt"
					  and object."transitionEffectsRequiredAt" is not null
					  and object."transitionEffectsCompletedAt" is null
					returning object."remoteId" as "remoteId"
				`,
				[JSON.stringify(unique)]
			)) as RawObjectQueryResult
		) as readonly { readonly remoteId: string }[];
		return new Set(rows.map((row) => row.remoteId));
	});
}

async function clearClaimSlot(
	query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
	remoteId: string,
	claimAttempt: number
): Promise<void> {
	await query(
		`update "history_archive_object_claim_slot"
		 set "objectRemoteId" = null, "claimAttempt" = null,
		     "claimedAt" = null, "updatedAt" = now()
		 where "objectRemoteId" = $1::uuid and "claimAttempt" = $2`,
		[remoteId, claimAttempt]
	);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 24;
	return Math.min(limit, 240);
}

const historyArchiveCompletionInputSql = `
        select *
        from jsonb_to_recordset($1::jsonb) as input(
                "remoteId" uuid,
                "claimAttempt" integer,
                "executionId" uuid,
                scheduler text,
                "bytesDownloaded" bigint,
                "hasBytesDownloaded" boolean,
                "hasVerificationFacts" boolean,
                "verificationFacts" jsonb,
                "workerStage" text,
                "archiveMetadata" jsonb
        )
`;

const historyArchiveObjectVerifiedBatchSql = `
        with input as materialized (
                ${historyArchiveCompletionInputSql}
        ), eligible as materialized (
                select input.*
                from input
                join "history_archive_object_queue" object
                        on object."remoteId" = input."remoteId"
                where (
                        input.scheduler = 'broker'
                        and input."executionId" is not null
                        and exists (
                                select 1
                                from "history_archive_object_ready" ready
                                where ready."objectRemoteId" = input."remoteId"
                                        and ready."dispatchToken" =
                                                input."executionId"
                                        and ready."claimAttempt" =
                                                input."claimAttempt"
                        )
                        and (
                                object.attempts < input."claimAttempt"
                                or (
                                        object.attempts = input."claimAttempt"
                                        and object.status <> 'verified'
                                )
                        )
                ) or (
                        input.scheduler <> 'broker'
                        and object.status = 'scanning'
                        and object.attempts = input."claimAttempt"
                )
        ), lockable as materialized (
                -- Checkpoint fan-out upserts existing queue rows in this unique-key
                -- order. Pre-lock completion rows in the same order to prevent a
                -- fan-out/completion cycle when their batches overlap.
                select object."remoteId"
                from eligible
                join "history_archive_object_queue" object
                        on object."remoteId" = eligible."remoteId"
                order by object."archiveUrlIdentity", object."objectType",
                        object."objectKey"
                for update of object
        ), updated as (
                update "history_archive_object_queue" object
                set "bytesDownloaded" = case
                                when eligible."hasBytesDownloaded"
                                        then eligible."bytesDownloaded"
                                else object."bytesDownloaded"
                        end,
                        "verificationFacts" = case
                                when eligible."hasVerificationFacts"
                                        then eligible."verificationFacts"
                                else object."verificationFacts"
                        end,
                        "workerStage" =
                                coalesce(eligible."workerStage", 'verified'),
                        "claimedAt" = null,
                        "claimedByCommunityScannerId" = null,
                        "completionArchiveMetadata" =
                                eligible."archiveMetadata",
                        "errorMessage" = null,
                        "errorType" = null,
                        "failureChannel" = null,
                        "httpStatus" = null,
                        "nextAttemptAt" = null,
                        "refreshAfter" = case
                                when object."objectType" =
                                                'history-archive-state'
                                        and object."objectKey" = 'root'
                                then now() + interval '5 minutes'
                                else object."refreshAfter"
                        end,
                        status = 'verified',
                        attempts = case
                                when eligible.scheduler = 'broker'
                                        then eligible."claimAttempt"
                                else object.attempts
                        end,
                        "transitionEffectsCompletedAt" = case
                                when object."objectType" in (
                                        'ledger', 'transactions', 'results', 'scp', 'bucket'
                                ) then now()
                                else null
                        end,
                        "transitionEffectsRequiredAt" = now(),
                        "updatedAt" = now(),
                        "verifiedAt" = now()
                from eligible
                join lockable
                        on lockable."remoteId" = eligible."remoteId"
                where object."remoteId" = eligible."remoteId"
                returning object."remoteId",
                        eligible."claimAttempt",
                        eligible."executionId",
                        eligible.scheduler
        ), verified_events as (
                insert into "history_archive_object_event" (
                        "objectRemoteId",
                        "archiveUrl", "archiveUrlIdentity",
                        "objectType", "objectKey", "objectUrl",
                        "eventType", "workerStage",
                        "checkpointLedger", "bucketHash", "bytesDownloaded",
                        "claimAttempt", "verificationFacts"
                )
                select object."remoteId",
                        object."archiveUrl", object."archiveUrlIdentity",
                        object."objectType", object."objectKey", object."objectUrl",
                        'verified', object."workerStage",
                        object."checkpointLedger", object."bucketHash",
                        object."bytesDownloaded", updated."claimAttempt",
                        object."verificationFacts"
                from updated
                join "history_archive_object_queue" object
                        on object."remoteId" = updated."remoteId"
                where object."objectType" in (
                        'ledger', 'transactions', 'results', 'scp', 'bucket'
                )
                        and not exists (
                                select 1
                                from "history_archive_object_event" event
                                where event."objectRemoteId" = object."remoteId"
                                        and event."eventType" = 'verified'
                                        and event."claimAttempt" =
                                                updated."claimAttempt"
                        )
                returning "objectRemoteId"
        ), claim_slots_cleared as (
                update "history_archive_object_claim_slot" slot
                set "objectRemoteId" = null,
                        "claimAttempt" = null,
                        "claimedAt" = null,
                        "updatedAt" = now()
                from updated
                where updated.scheduler <> 'broker'
                        and slot."objectRemoteId" = updated."remoteId"
                        and slot."claimAttempt" = updated."claimAttempt"
                returning slot.slot
        ), broker_ready_removed as (
                delete from "history_archive_object_ready" ready
                using updated
                where updated.scheduler = 'broker'
                        and ready."objectRemoteId" = updated."remoteId"
                        and ready."dispatchToken" = updated."executionId"
                        and ready."claimAttempt" = updated."claimAttempt"
                returning ready."objectRemoteId"
        )
        select updated."remoteId"
        from updated
`;

const staleReleaseSettingsSql = `
	set local lock_timeout = '250ms';
	set local statement_timeout = '1500ms'
`;

const historyArchiveObjectHeartbeatSql = `
	update "history_archive_object_claim_slot"
	set "updatedAt" = now()
	where "objectRemoteId" = $1::uuid and "claimAttempt" = $2
	returning slot
`;

export const historyArchiveObjectStaleReleaseSql = `
	with maintenance_guard as materialized (
		select pg_try_advisory_xact_lock(
			hashtext('history_archive_object_stale_release')
		) as locked
	), candidates as (
		select object.id
		from "history_archive_object_claim_slot" slot
		join "history_archive_object_queue" object
			on object."remoteId" = slot."objectRemoteId"
			and object.status = 'scanning'
			and object.attempts = slot."claimAttempt"
		cross join maintenance_guard
		where maintenance_guard.locked
			and slot."updatedAt" < $1
		order by slot."updatedAt", object.id
		for update of slot, object skip locked
		limit $2
	), released as (
		update "history_archive_object_queue" object
		set "claimedAt" = null,
			"claimedByCommunityScannerId" = null,
			status = 'pending',
			"workerStage" = null,
			"updatedAt" = now()
		from candidates
		where object.id = candidates.id
		returning object.*
	), freed as (
		update "history_archive_object_claim_slot" slot
		set "objectRemoteId" = null,
			"claimAttempt" = null,
			"claimedAt" = null,
			"updatedAt" = now()
		from released
		where slot."objectRemoteId" = released."remoteId"
		returning released."remoteId" as "releasedRemoteId"
	)
	select released.*
	from released
	left join freed on freed."releasedRemoteId" = released."remoteId"
`;
