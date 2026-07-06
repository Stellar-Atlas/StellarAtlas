import { injectable } from 'inversify';
import { Repository } from 'typeorm';
import { getHistoryArchiveUrlIdentity } from '@history-scan-coordinator/domain/ArchiveUrlIdentity.js';
import { HistoryArchiveObject } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import {
	getHistoryArchiveStateRefreshBefore,
	getRefreshableHistoryArchiveStateArchiveIdentities
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRefreshPolicy.js';
import type { HistoryArchiveObjectType } from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObject.js';
import type {
	HistoryArchiveObjectFailure,
	HistoryArchiveObjectQueueSnapshot,
	HistoryArchiveObjectQueueStats,
	HistoryArchiveObjectProgressUpdate,
	HistoryArchiveObjectRepository
} from '@history-scan-coordinator/domain/history-archive-object/HistoryArchiveObjectRepository.js';
import { requireNumber } from './ScanJobRowMapper.js';
import {
	createObjectFromRow,
	extractRows,
	normalizeLimit,
	statusRankSql,
	type RawObjectQueryResult,
	type RawObjectStatsRow
} from './HistoryArchiveObjectRowMapper.js';
import {
	createActiveUpdate,
	createFailedUpdate,
	createVerifiedUpdate
} from './HistoryArchiveObjectUpdateFactory.js';
import { findOldestCheckpointLedgers } from './HistoryArchiveObjectCheckpointQuery.js';

const maxActiveObjectsPerArchive = 1;
const maxActiveObjectsPerHost = 2;
const maxActiveObjectsTotal = 24;
const claimLockName = 'history_archive_object_claim';

@injectable()
export class TypeOrmHistoryArchiveObjectRepository
	implements HistoryArchiveObjectRepository
{
	constructor(
		private readonly repository: Repository<HistoryArchiveObject>
	) {}

	async claimNextObject(
		supportedTypes: readonly HistoryArchiveObjectType[]
	): Promise<HistoryArchiveObject | null> {
		if (supportedTypes.length === 0) return null;

		return await this.repository.manager.transaction(async (manager) => {
			await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
				claimLockName
			]);

			const rows = extractRows(
				(await manager.query(
				`
				with next_candidate as (
					select candidate.id
					from history_archive_object_queue candidate
					where (
							candidate.status = 'pending'
							or (
								candidate.status = 'failed'
								and coalesce(
									candidate."nextAttemptAt",
									candidate."updatedAt" + interval '1 hour'
								) <= now()
							)
						)
						and candidate."objectType" = any($1)
						and (
							select count(*)
							from history_archive_object_queue active
							where active.status = 'scanning'
						) < $3
						and (
							select count(*)
							from history_archive_object_queue active
							where active.status = 'scanning'
								and active."archiveUrlIdentity" =
									candidate."archiveUrlIdentity"
						) < $2
						and (
							select count(*)
							from history_archive_object_queue active
							where active.status = 'scanning'
								and active."hostIdentity" = candidate."hostIdentity"
						) < $4
					order by
						(
							select max(previous."claimedAt")
							from history_archive_object_queue previous
							where previous."archiveUrlIdentity" =
								candidate."archiveUrlIdentity"
						) asc nulls first,
						candidate."objectOrder" asc,
						candidate."objectKey" asc,
						candidate."archiveUrlIdentity" asc
					for update skip locked
					limit 1
				)
				update history_archive_object_queue
				set status = 'scanning',
					"claimedAt" = now(),
					"attempts" = "attempts" + 1,
					"workerStage" = 'claimed',
					"errorType" = null,
					"errorMessage" = null,
					"httpStatus" = null,
					"nextAttemptAt" = null,
					"updatedAt" = now()
				where id = (select id from next_candidate)
				returning
					"remoteId" as "remoteId",
					"archiveUrl" as "archiveUrl",
					"archiveUrlIdentity" as "archiveUrlIdentity",
					"hostIdentity" as "hostIdentity",
					"objectType" as "objectType",
					"objectKey" as "objectKey",
					"objectOrder" as "objectOrder",
					"objectUrl" as "objectUrl",
					status as "status",
					"workerStage" as "workerStage",
					"checkpointLedger" as "checkpointLedger",
					"bucketHash" as "bucketHash",
					"bytesDownloaded" as "bytesDownloaded",
					attempts as "attempts",
					"nextAttemptAt" as "nextAttemptAt",
					"refreshAfter" as "refreshAfter",
					"claimedAt" as "claimedAt",
					"claimedByCommunityScannerId" as "claimedByCommunityScannerId",
					"errorType" as "errorType",
					"errorMessage" as "errorMessage",
					"httpStatus" as "httpStatus",
					"verificationFacts" as "verificationFacts",
					"verifiedAt" as "verifiedAt",
					"createdAt" as "createdAt",
					"updatedAt" as "updatedAt"
				`,
				[
					[...supportedTypes],
					maxActiveObjectsPerArchive,
					maxActiveObjectsTotal,
					maxActiveObjectsPerHost
				]
				)) as RawObjectQueryResult
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

	findByRemoteId(remoteId: string): Promise<HistoryArchiveObject | null> {
		return this.repository.findOneBy({ remoteId });
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

	async saveObjects(
		objects: readonly HistoryArchiveObject[]
	): Promise<number> {
		if (objects.length === 0) return 0;

		const result = await this.repository
			.createQueryBuilder()
			.insert()
			.into(HistoryArchiveObject)
			.values([...objects])
			.orIgnore()
			.execute();

		const refreshedCount = await this.requeueStaleHistoryArchiveStateObjects(
			objects,
			getHistoryArchiveStateRefreshBefore()
		);

		return result.identifiers.length + refreshedCount;
	}

	private async requeueStaleHistoryArchiveStateObjects(
		objects: readonly HistoryArchiveObject[],
		before: Date
	): Promise<number> {
		const archiveUrlIdentities =
			getRefreshableHistoryArchiveStateArchiveIdentities(objects);
		if (archiveUrlIdentities.length === 0) return 0;

		const result = await this.repository
			.createQueryBuilder()
			.update(HistoryArchiveObject)
			.set({
				bytesDownloaded: null,
				claimedAt: null,
				claimedByCommunityScannerId: null,
				errorMessage: null,
				errorType: null,
				httpStatus: null,
				nextAttemptAt: null,
				status: 'pending',
				updatedAt: () => 'now()',
				verifiedAt: null,
				workerStage: null
			})
			.where('"archiveUrlIdentity" IN (:...archiveUrlIdentities)', {
				archiveUrlIdentities
			})
			.andWhere('"objectType" = :objectType', {
				objectType: 'history-archive-state'
			})
			.andWhere('"objectKey" = :objectKey', { objectKey: 'root' })
			.andWhere('status = :status', { status: 'verified' })
			.andWhere(
				`(
					"refreshAfter" <= now()
					or (
						"refreshAfter" is null
						and "updatedAt" < :before
					)
				)`,
				{ before }
			)
			.execute();

		return result.affected ?? 0;
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

	async releaseObject(remoteId: string, claimAttempt: number): Promise<boolean> {
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
		const query = this.repository
			.createQueryBuilder('archiveObject')
			.select(
				"count(*) filter (where archiveObject.status = 'pending')",
				'pendingObjects'
			)
			.addSelect(
				"count(*) filter (where archiveObject.status = 'scanning')",
				'activeObjects'
			)
			.addSelect(
				"count(*) filter (where archiveObject.status = 'verified')",
				'verifiedObjects'
			)
			.addSelect(
				"count(*) filter (where archiveObject.status = 'failed')",
				'failedObjects'
			);
		if (archiveUrlIdentity !== undefined) {
			query.where('archiveObject.archiveUrlIdentity = :archiveUrlIdentity', {
				archiveUrlIdentity
			});
		}

		const row = await query.getRawOne<RawObjectStatsRow>();

		return {
			activeObjects: requireNumber(
				row?.activeObjects ?? row?.activeobjects,
				'activeObjects'
			),
			failedObjects: requireNumber(
				row?.failedObjects ?? row?.failedobjects,
				'failedObjects'
			),
			pendingObjects: requireNumber(
				row?.pendingObjects ?? row?.pendingobjects,
				'pendingObjects'
			),
			verifiedObjects: requireNumber(
				row?.verifiedObjects ?? row?.verifiedobjects,
				'verifiedObjects'
			)
		};
	}

	private async getObjects(
		limit: number,
		archiveUrlIdentity?: string
	): Promise<readonly HistoryArchiveObject[]> {
		const query = this.repository
			.createQueryBuilder('archiveObject')
			.orderBy(statusRankSql('"archiveObject"."status"'), 'ASC')
			.addOrderBy('archiveObject.objectOrder', 'ASC')
			.addOrderBy('archiveObject.objectKey', 'ASC')
			.addOrderBy('archiveObject.archiveUrlIdentity', 'ASC')
			.addOrderBy('archiveObject.updatedAt', 'DESC')
			.take(limit);
		if (archiveUrlIdentity !== undefined) {
			query.where('archiveObject.archiveUrlIdentity = :archiveUrlIdentity', {
				archiveUrlIdentity
			});
		}

		return await query.getMany();
	}
}
