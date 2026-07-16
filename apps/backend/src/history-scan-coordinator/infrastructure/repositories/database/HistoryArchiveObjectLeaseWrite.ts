import type { Repository } from 'typeorm';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectProgressUpdate } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { createVerifiedUpdate } from './HistoryArchiveObjectUpdateFactory.js';
import {
	createObjectFromRow,
	extractRows,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';
import { hasPostgresSqlState } from './PostgresError.js';

export async function markHistoryArchiveObjectVerified(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	progress: HistoryArchiveObjectProgressUpdate
): Promise<boolean> {
	return await repository.manager.transaction(async (manager) => {
		const result = await manager
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(createVerifiedUpdate(progress))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', {
				claimAttempt: progress.claimAttempt
			})
			.execute();
		if ((result.affected ?? 0) === 0) return false;

		await clearClaimSlot(manager.query.bind(manager), remoteId);
		return true;
	});
}

export async function releaseHistoryArchiveObject(
	repository: Repository<HistoryArchiveObject>,
	remoteId: string,
	claimAttempt: number
): Promise<boolean> {
	return await repository.manager.transaction(async (manager) => {
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

		await clearClaimSlot(manager.query.bind(manager), remoteId);
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
			return rows.map(createObjectFromRow);
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
	const result = await repository
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
	return (result.affected ?? 0) > 0;
}

async function clearClaimSlot(
	query: (sql: string, parameters?: unknown[]) => Promise<unknown>,
	remoteId: string
): Promise<void> {
	await query(
		`update "history_archive_object_claim_slot"
		 set "objectRemoteId" = null, "claimedAt" = null, "updatedAt" = now()
		 where "objectRemoteId" = $1::uuid`,
		[remoteId]
	);
}

function normalizeLimit(limit: number): number {
	if (!Number.isSafeInteger(limit) || limit < 1) return 24;
	return Math.min(limit, 240);
}

const staleReleaseSettingsSql = `
	set local lock_timeout = '250ms';
	set local statement_timeout = '1500ms'
`;

export const historyArchiveObjectStaleReleaseSql = `
	with maintenance_guard as materialized (
		select pg_try_advisory_xact_lock(
			hashtext('history_archive_object_stale_release')
		) as locked
	), candidates as (
		select id
		from "history_archive_object_queue"
		cross join maintenance_guard
		where maintenance_guard.locked
			and status = 'scanning'
			and "updatedAt" < $1
		order by "updatedAt", id
		for update skip locked
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
