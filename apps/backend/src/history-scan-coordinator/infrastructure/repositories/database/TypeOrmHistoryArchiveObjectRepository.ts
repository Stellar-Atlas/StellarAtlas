import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type { HistoryArchiveObjectType } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectHostFailure,
	HistoryArchiveObjectQueueSnapshot,
	HistoryArchiveObjectQueueStats,
	HistoryArchiveObjectProgressUpdate,
	HistoryArchiveObjectRepository,
	HistoryArchiveObjectWorkerSnapshot
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { requireNumber } from './ScanJobRowMapper.js';
import {
	createObjectFromRow,
	extractRows,
	normalizeLimit,
	statusRankSql,
	type RawObjectQueryResult
} from './HistoryArchiveObjectRowMapper.js';
import {
	createActiveUpdate,
	createFailedUpdate,
	createVerifiedUpdate
} from './HistoryArchiveObjectUpdateFactory.js';
import { findOldestCheckpointLedgers } from './HistoryArchiveObjectCheckpointQuery.js';
import {
	historyArchiveObjectClaimLockSql,
	historyArchiveObjectClaimSql
} from './HistoryArchiveObjectClaimSql.js';
import { getHistoryArchiveObjectSummary } from './HistoryArchiveObjectSummaryQuery.js';
import { getHistoryArchiveObjectStatusSummary } from './HistoryArchiveObjectStatusSummaryQuery.js';
import { findHistoryArchiveObjects } from './HistoryArchiveObjectListQuery.js';
import { getHistoryArchiveObjectStats } from './HistoryArchiveObjectStatsQuery.js';
import {
	markCapturedHistoryArchiveStateObjectsVerified,
	requeueStaleHistoryArchiveStateObjects
} from './HistoryArchiveObjectStateRefreshQuery.js';
import {
	historyArchiveObjectHostFailureUpsertSql,
	historyArchiveObjectHostThrottleDeleteSql,
	toHistoryArchiveObjectHostFailureSqlParams
} from './HistoryArchiveObjectHostThrottleSql.js';

const maxActiveObjectsPerArchive = 1;
const maxActiveObjectsPerHost = 2;
const maxActiveObjectsTotal = 24;
const claimLockName = 'history_archive_object_claim';
const saveObjectChunkSize = 200;

@injectable()
export class TypeOrmHistoryArchiveObjectRepository implements HistoryArchiveObjectRepository {
	constructor(private readonly repository: Repository<HistoryArchiveObject>) {}

	async claimNextObject(
		supportedTypes: readonly HistoryArchiveObjectType[]
	): Promise<HistoryArchiveObject | null> {
		if (supportedTypes.length === 0) return null;

		return await this.repository.manager.transaction(async (manager) => {
			await manager.query('set local jit = off');
			const [lockRow] = (await manager.query(historyArchiveObjectClaimLockSql, [
				claimLockName
			])) as readonly { readonly locked?: boolean }[];
			if (lockRow?.locked !== true) return null;

			const rows = extractRows(
				(await manager.query(historyArchiveObjectClaimSql, [
					[...supportedTypes],
					maxActiveObjectsPerArchive,
					maxActiveObjectsTotal,
					maxActiveObjectsPerHost
				])) as RawObjectQueryResult
			);

			const row = rows[0];
			if (row === undefined) return null;

			return createObjectFromRow(row);
		});
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

	findByRemoteId(remoteId: string): Promise<HistoryArchiveObject | null> {
		return this.repository.findOneBy({ remoteId });
	}

	async findBucketObjectsByHash(
		bucketHash: string
	): Promise<readonly HistoryArchiveObject[]> {
		const normalizedBucketHash = bucketHash.toLowerCase();

		return await this.repository
			.createQueryBuilder('archiveObject')
			.where('archiveObject.objectType = :objectType', {
				objectType: 'bucket'
			})
			.andWhere('archiveObject.objectKey = :objectKey', {
				objectKey: `bucket:${normalizedBucketHash}`
			})
			.orderBy(statusRankSql('"archiveObject"."status"'), 'ASC')
			.addOrderBy('archiveObject.archiveUrlIdentity', 'ASC')
			.addOrderBy('archiveObject.updatedAt', 'DESC')
			.getMany();
	}

	async clearHostThrottle(hostIdentity: string): Promise<void> {
		await this.repository.manager.query(
			historyArchiveObjectHostThrottleDeleteSql,
			[hostIdentity]
		);
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

	async findVerifiedBucketObjectsByArchiveUrl(
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
			.andWhere('archiveObject.objectType = :objectType', {
				objectType: 'bucket'
			})
			.andWhere('archiveObject.status = :status', { status: 'verified' })
			.orderBy('archiveObject.verifiedAt', 'DESC')
			.addOrderBy('archiveObject.bucketHash', 'ASC')
			.take(normalizeLimit(limit))
			.getMany();
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
		const [row] = (await this.repository.manager.query(
			`
			with scanning as (
				select
					count(*)::int as "totalScanningObjects",
					count(*) filter (where "updatedAt" >= $1)::int as "activeObjects",
					count(*) filter (where "updatedAt" < $1)::int as "staleObjects"
				from "history_archive_object_queue"
				where status = 'scanning'
			),
			pending as (
				select exists (
					select 1
					from "history_archive_object_queue"
					where status = 'pending'
						and ("nextAttemptAt" is null or "nextAttemptAt" <= now())
					limit 1
				) as "hasPendingObjects"
			)
			select
				scanning."totalScanningObjects",
				scanning."activeObjects",
				scanning."staleObjects",
				pending."hasPendingObjects"
			from scanning, pending
			`,
			[staleCutoff]
		)) as readonly {
			readonly activeObjects?: number | string;
			readonly activeobjects?: number | string;
			readonly hasPendingObjects?: boolean;
			readonly haspendingobjects?: boolean;
			readonly staleObjects?: number | string;
			readonly staleobjects?: number | string;
			readonly totalScanningObjects?: number | string;
			readonly totalscanningobjects?: number | string;
		}[];

		return {
			activeObjects: requireNumber(
				row?.activeObjects ?? row?.activeobjects,
				'activeObjects'
			),
			hasPendingObjects: Boolean(
				row?.hasPendingObjects ?? row?.haspendingobjects
			),
			staleObjects: requireNumber(
				row?.staleObjects ?? row?.staleobjects,
				'staleObjects'
			),
			totalScanningObjects: requireNumber(
				row?.totalScanningObjects ?? row?.totalscanningobjects,
				'totalScanningObjects'
			)
		};
	}

	async saveObjects(objects: readonly HistoryArchiveObject[]): Promise<number> {
		if (objects.length === 0) return 0;

		let insertedCount = 0;
		for (let index = 0; index < objects.length; index += saveObjectChunkSize) {
			const result = await this.repository
				.createQueryBuilder()
				.insert()
				.into(HistoryArchiveObject)
				.values([...objects.slice(index, index + saveObjectChunkSize)])
				.orIgnore()
				.execute();
			insertedCount += result.identifiers.length;
		}

		const refreshedCount = await requeueStaleHistoryArchiveStateObjects(
			this.repository.manager,
			objects
		);
		await markCapturedHistoryArchiveStateObjectsVerified(
			this.repository.manager,
			objects
		);

		return insertedCount + refreshedCount;
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

	async markObjectVerified(
		remoteId: string,
		progress?: HistoryArchiveObjectProgressUpdate
	): Promise<boolean> {
		if (progress === undefined) return false;
		const result = await this.repository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(createVerifiedUpdate(progress))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', {
				claimAttempt: progress.claimAttempt
			})
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async recordHostFailure(
		failure: HistoryArchiveObjectHostFailure
	): Promise<void> {
		await this.repository.manager.query(
			historyArchiveObjectHostFailureUpsertSql,
			[...toHistoryArchiveObjectHostFailureSqlParams(failure)]
		);
	}

	async markObjectFailed(
		remoteId: string,
		failure: HistoryArchiveObjectFailure
	): Promise<boolean> {
		const result = await this.repository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set(createFailedUpdate(failure))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'scanning' })
			.andWhere('attempts = :claimAttempt', {
				claimAttempt: failure.claimAttempt
			})
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async releaseObject(
		remoteId: string,
		claimAttempt: number
	): Promise<boolean> {
		const result = await this.repository
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

		return (result.affected ?? 0) > 0;
	}

	async releaseStaleObjects(before: Date): Promise<number> {
		const result = await this.repository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set({
				claimedAt: null,
				claimedByCommunityScannerId: null,
				status: 'pending',
				updatedAt: () => 'now()',
				workerStage: null
			})
			.where('status = :status', { status: 'scanning' })
			.andWhere('"updatedAt" < :before', { before })
			.execute();

		return result.affected ?? 0;
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
