import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	historyArchiveConsumerCount,
	historyArchivePerHostConcurrency,
	historyArchivePerRootFrontier
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectPlanningPolicy.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectHostFailure,
	HistoryArchiveObjectProgressUpdate,
	HistoryArchiveObjectQueueSnapshot,
	HistoryArchiveObjectQueueStats,
	HistoryArchiveObjectRepository,
	HistoryArchiveObjectWorkerSnapshot
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { requireNumber } from './ScanJobRowMapper.js';
import {
	normalizeLimit,
	statusRankSql
} from './HistoryArchiveObjectRowMapper.js';
import { createActiveUpdate } from './HistoryArchiveObjectUpdateFactory.js';
import { findOldestCheckpointLedgers } from './HistoryArchiveObjectCheckpointQuery.js';
import { claimHistoryArchiveObject } from './HistoryArchiveObjectClaimRunner.js';
import { getHistoryArchiveObjectSummary } from './HistoryArchiveObjectSummaryQuery.js';
import { getHistoryArchiveObjectStatusSummary } from './HistoryArchiveObjectStatusSummaryQuery.js';
import { findHistoryArchiveObjects } from './HistoryArchiveObjectListQuery.js';
import { getHistoryArchiveObjectStats } from './HistoryArchiveObjectStatsQuery.js';
import { findLatestHistoryArchiveObjectActivityAt } from './HistoryArchiveObjectActivityQuery.js';
import { markHistoryArchiveObjectFailed } from './HistoryArchiveObjectFailureWrite.js';
import {
	planHistoryArchiveObjects,
	promoteHistoryArchiveObjectPlans
} from './HistoryArchiveObjectPlanStore.js';
import {
	markHistoryArchiveObjectVerified,
	markHistoryArchiveTransitionEffectsCompleted,
	releaseHistoryArchiveObject,
	releaseStaleHistoryArchiveObjects
} from './HistoryArchiveObjectLeaseWrite.js';
import {
	materializeHistoryArchiveCheckpointDependencies,
	reconcileHistoryArchiveDependencyReadiness
} from './HistoryArchiveObjectDependencyWrite.js';
import { reconcileHistoryArchiveObjectExecution } from './HistoryArchiveObjectExecutionReconciler.js';
import { findVerifiedCheckpointsNeedingReconciliation } from './HistoryArchiveCheckpointReconciliationQuery.js';

const maxActiveObjectsPerArchive = historyArchivePerRootFrontier;
const maxActiveObjectsPerHost = historyArchivePerHostConcurrency;
const maxActiveObjectsTotal = historyArchiveConsumerCount;
const transitionReconciliationLockName =
	'history_archive_object_transition_reconciliation';

@injectable()
export class TypeOrmHistoryArchiveObjectRepository implements HistoryArchiveObjectRepository {
	constructor(private readonly repository: Repository<HistoryArchiveObject>) {}

	async claimNextObject(
		supportedTypes: readonly HistoryArchiveObjectType[]
	): Promise<HistoryArchiveObject | null> {
		if (supportedTypes.length === 0) return null;
		return await claimHistoryArchiveObject(this.repository, supportedTypes);
	}

	async findActionableByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<readonly HistoryArchiveObject[]> {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) return [];

		return await this.repository
			.createQueryBuilder('archiveObject')
			.where('archiveObject.archiveUrlIdentity = :archiveUrlIdentity', {
				archiveUrlIdentity
			})
			.andWhere('archiveObject.status = :status', { status: 'failed' })
			.orderBy('archiveObject.updatedAt', 'DESC')
			.addOrderBy('archiveObject.objectOrder', 'ASC')
			.addOrderBy('archiveObject.objectKey', 'ASC')
			.take(normalizeLimit(limit))
			.getMany();
	}

	async findByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<HistoryArchiveObjectQueueSnapshot> {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) {
			return {
				activeObjects: 0,
				failedObjects: 0,
				objects: [],
				pendingObjects: 0,
				verifiedObjects: 0
			};
		}
		return await this.getSnapshot(limit, archiveUrlIdentity);
	}

	findByRemoteId(remoteId: string): Promise<HistoryArchiveObject | null> {
		return this.repository.findOneBy({ remoteId });
	}

	async findBucketObjectsByHash(
		bucketHash: string
	): Promise<readonly HistoryArchiveObject[]> {
		return await this.repository
			.createQueryBuilder('archiveObject')
			.where('archiveObject.objectType = :objectType', { objectType: 'bucket' })
			.andWhere('archiveObject.objectKey = :objectKey', {
				objectKey: `bucket:${bucketHash.toLowerCase()}`
			})
			.orderBy(statusRankSql('"archiveObject"."status"'), 'ASC')
			.addOrderBy('archiveObject.archiveUrlIdentity', 'ASC')
			.addOrderBy('archiveObject.updatedAt', 'DESC')
			.getMany();
	}

	async findLatestActivityAt(): Promise<Date | null> {
		return await findLatestHistoryArchiveObjectActivityAt(this.repository);
	}

	async findOldestCheckpointLedgerByArchiveUrlIdentities(
		archiveUrlIdentities: readonly string[]
	): Promise<ReadonlyMap<string, number>> {
		if (archiveUrlIdentities.length === 0) return new Map();
		return await findOldestCheckpointLedgers(
			this.repository.manager,
			archiveUrlIdentities
		);
	}

	async findUnreconciledTransitions(
		limit: number
	): Promise<readonly HistoryArchiveObject[]> {
		return await this.repository
			.createQueryBuilder('object')
			.where('object.status in (:...statuses)', {
				statuses: ['verified', 'failed']
			})
			.andWhere('object.transitionEffectsCompletedAt is null')
			.andWhere('object.transitionEffectsRequiredAt is not null')
			.orderBy('object.transitionEffectsRequiredAt', 'ASC')
			.addOrderBy('object.id', 'ASC')
			.take(normalizeLimit(limit))
			.getMany();
	}

	async findVerifiedCheckpointsNeedingReconciliation(
		limit: number
	): Promise<readonly HistoryArchiveObject[]> {
		return await findVerifiedCheckpointsNeedingReconciliation(
			this.repository,
			limit
		);
	}

	async findVerifiedBucketObjectsByArchiveUrl(
		archiveUrl: string,
		limit: number
	): Promise<readonly HistoryArchiveObject[]> {
		const archiveUrlIdentity = getHistoryArchiveUrlIdentity(archiveUrl);
		if (archiveUrlIdentity === null) return [];
		return await this.repository.find({
			where: { archiveUrlIdentity, objectType: 'bucket', status: 'verified' },
			order: { bucketHash: 'ASC', verifiedAt: 'DESC' },
			take: normalizeLimit(limit)
		});
	}

	async getQueueSnapshot(
		limit: number
	): Promise<HistoryArchiveObjectQueueSnapshot> {
		return await this.getSnapshot(limit);
	}

	async getSummary(
		options: {
			readonly archiveUrl?: string | null;
			readonly archiveUrlIdentity?: string | null;
		} = {}
	) {
		return await getHistoryArchiveObjectSummary(
			this.repository.manager,
			options
		);
	}

	async getStatusSummary() {
		return await getHistoryArchiveObjectStatusSummary(this.repository.manager);
	}

	async getWorkerSnapshot(
		staleCutoff: Date
	): Promise<HistoryArchiveObjectWorkerSnapshot> {
		const [row] = (await this.repository.manager.query(workerSnapshotSql, [
			staleCutoff
		])) as readonly WorkerSnapshotRow[];
		return {
			activeObjects: requireNumber(row?.activeObjects, 'activeObjects'),
			hasPendingObjects: Boolean(row?.hasPendingObjects),
			staleObjects: requireNumber(row?.staleObjects, 'staleObjects'),
			totalScanningObjects: requireNumber(
				row?.totalScanningObjects,
				'totalScanningObjects'
			)
		};
	}

	async markObjectActive(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean> {
		if (progress === undefined) return false;
		const result = await this.repository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(createActiveUpdate(progress))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', {
				claimAttempt: progress.claimAttempt
			})
			.execute();
		return (result.affected ?? 0) > 0;
	}

	async markObjectFailed(
		remoteId: string,
		failure: HistoryArchiveObjectFailure,
		hostFailure?: HistoryArchiveObjectHostFailure
	): Promise<boolean> {
		return await markHistoryArchiveObjectFailed(
			this.repository,
			remoteId,
			failure,
			hostFailure
		);
	}

	async markObjectVerified(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean> {
		if (progress === undefined) return false;
		return await markHistoryArchiveObjectVerified(
			this.repository,
			remoteId,
			progress
		);
	}

	async markTransitionEffectsCompleted(
		remoteId: string,
		claimAttempt: number,
		status: 'failed' | 'verified'
	): Promise<boolean> {
		return await markHistoryArchiveTransitionEffectsCompleted(
			this.repository,
			remoteId,
			claimAttempt,
			status
		);
	}

	async materializeCheckpointDependencies(remoteId: string): Promise<number> {
		return await materializeHistoryArchiveCheckpointDependencies(
			this.repository,
			remoteId
		);
	}

	async planObjects(objects: readonly HistoryArchiveObject[]): Promise<number> {
		return await planHistoryArchiveObjects(this.repository, objects);
	}

	async promotePlannedObjects() {
		return await promoteHistoryArchiveObjectPlans(this.repository);
	}

	async reconcileDependencyReadiness(limit: number): Promise<number> {
		return await reconcileHistoryArchiveDependencyReadiness(
			this.repository,
			limit
		);
	}

	async reconcileExecutionDisposition() {
		return await reconcileHistoryArchiveObjectExecution(this.repository);
	}

	async tryWithTransitionReconciliationLock(
		work: () => Promise<void>
	): Promise<boolean> {
		const queryRunner = this.repository.manager.connection.createQueryRunner();

		try {
			await queryRunner.connect();
			const [row] = (await queryRunner.query(
				'select pg_try_advisory_lock(hashtext($1)) as locked',
				[transitionReconciliationLockName]
			)) as readonly { readonly locked?: boolean }[];
			if (row?.locked !== true) return false;

			try {
				await work();
				return true;
			} finally {
				await queryRunner.query('select pg_advisory_unlock(hashtext($1))', [
					transitionReconciliationLockName
				]);
			}
		} finally {
			await queryRunner.release();
		}
	}

	async releaseObject(
		remoteId: string,
		claimAttempt: number
	): Promise<boolean> {
		return await releaseHistoryArchiveObject(
			this.repository,
			remoteId,
			claimAttempt
		);
	}

	async releaseStaleObjects(
		before: Date,
		limit = 24
	): Promise<readonly HistoryArchiveObject[]> {
		return await releaseStaleHistoryArchiveObjects(
			this.repository,
			before,
			limit
		);
	}

	private async getSnapshot(
		limit: number,
		archiveUrlIdentity?: string
	): Promise<HistoryArchiveObjectQueueSnapshot> {
		const safeLimit = normalizeLimit(limit);
		const [stats, objects] = await Promise.all([
			this.getStats(archiveUrlIdentity),
			this.getObjects(safeLimit, archiveUrlIdentity)
		]);
		return { ...stats, objects };
	}

	private async getStats(
		archiveUrlIdentity?: string
	): Promise<HistoryArchiveObjectQueueStats> {
		return await getHistoryArchiveObjectStats(
			this.repository.manager,
			archiveUrlIdentity
		);
	}

	private async getObjects(
		limit: number,
		archiveUrlIdentity?: string
	): Promise<readonly HistoryArchiveObject[]> {
		return await findHistoryArchiveObjects(this.repository.manager, {
			archiveUrlIdentity,
			limit,
			maxActiveObjectsPerArchive,
			maxActiveObjectsPerHost,
			maxActiveObjectsTotal
		});
	}
}

const workerSnapshotSql = `
	with scanning as (
		select
			count(*)::int as "totalScanningObjects",
			count(*) filter (where "updatedAt" >= $1)::int as "activeObjects",
			count(*) filter (where "updatedAt" < $1)::int as "staleObjects"
		from "history_archive_object_queue"
		where status = 'scanning'
	), pending as (
		select exists (
			select 1 from "history_archive_object_queue"
			where status in ('pending', 'failed')
				and "executionDisposition" = 'executable'
				and "dependencyReady" = true
				and (
					status = 'pending'
					or coalesce(
						"nextAttemptAt",
						"updatedAt" + interval '1 hour'
					) <= now()
				)
			limit 1
		) as "hasPendingObjects"
	)
	select scanning.*, pending."hasPendingObjects" from scanning, pending
`;

interface WorkerSnapshotRow {
	readonly activeObjects?: number | string;
	readonly hasPendingObjects?: boolean;
	readonly staleObjects?: number | string;
	readonly totalScanningObjects?: number | string;
}
