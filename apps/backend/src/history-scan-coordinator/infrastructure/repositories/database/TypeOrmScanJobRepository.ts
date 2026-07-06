import { injectable } from 'inversify';
import type {
	ArchiveScanQueueStats,
	ArchiveScanTakenJobsSnapshot,
	ScanJobRepository
} from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import {
	decideCommunityScannerClaim,
	type CommunityScannerClaimState
} from '@history-scan-coordinator/domain/CommunityScannerClaimPolicy.js';
import { EntityManager, MoreThan, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import {
	createScanJobFromRow,
	extractQueryRows,
	requireNumber,
	type NumericValue,
	type RawQueryResult,
	type RawQueueStatsRow,
	type RawScanJobRow,
	type RawTakenJobStatsRow
} from './ScanJobRowMapper.js';
import type { ScanJobProgressUpdate } from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { saveScanJobsWithActiveIdentityGuard } from './ScanJobActiveInsert.js';

type RawActiveCommunityScannerJobsRow = {
	readonly activeJobs?: NumericValue;
	readonly activejobs?: NumericValue;
};

type RawCommunityScannerClaimStateRow = {
	readonly isBlocked?: boolean;
	readonly isblocked?: boolean;
	readonly successRate?: NumericValue;
	readonly successrate?: NumericValue;
	readonly totalJobsCompleted?: NumericValue;
	readonly totaljobscompleted?: NumericValue;
	readonly totalJobsFailed?: NumericValue;
	readonly totaljobsfailed?: NumericValue;
};

const claimLockName = 'history_archive_scan_job_claim';
const schedulingLockName = 'history_archive_scan_job_schedule';
const maxActiveTakenJobsPerArchiveHost = 1;

@injectable()
export class TypeOrmScanJobRepository implements ScanJobRepository {
	constructor(private baseRepository: Repository<ScanJob>) {}

	async save(scanJobs: ScanJob[]): Promise<number> {
		return await saveScanJobsWithActiveIdentityGuard(
			this.baseRepository,
			scanJobs
		);
	}

	async withSchedulingLock<T>(work: () => Promise<T>): Promise<T> {
		const queryRunner =
			this.baseRepository.manager.connection.createQueryRunner();

		try {
			await queryRunner.connect();
			await queryRunner.query('select pg_advisory_lock(hashtext($1))', [
				schedulingLockName
			]);
			try {
				return await work();
			} finally {
				await queryRunner.query('select pg_advisory_unlock(hashtext($1))', [
					schedulingLockName
				]);
			}
		} finally {
			await queryRunner.release();
		}
	}

	async fetchNextJob(): Promise<ScanJob | null> {
		return await this.baseRepository.manager.transaction(async (manager) => {
			const rows = await this.claimNextPendingJob(manager, null);
			const row = rows[0];
			if (row === undefined) return null;

			return createScanJobFromRow(row);
		});
	}

	async fetchNextJobForCommunityScanner(
		communityScannerId: string,
		activeJobLimit: number,
		staleTakenBefore: Date
	): Promise<ScanJob | null> {
		return await this.baseRepository.manager.transaction(async (manager) => {
			const scannerState = await this.readLockedCommunityScannerClaimState(
				manager,
				communityScannerId
			);
			if (scannerState === null) return null;

			const activeJobs = await this.countActiveCommunityScannerJobs(
				manager,
				communityScannerId,
				staleTakenBefore
			);
			const decision = decideCommunityScannerClaim({
				...scannerState,
				activeJobs,
				maxActiveJobs: activeJobLimit
			});
			if (!decision.allowed) return null;

			const rows = await this.claimNextPendingJob(manager, communityScannerId);
			const row = rows[0];
			if (row === undefined) return null;

			return createScanJobFromRow(row);
		});
	}

	private async readLockedCommunityScannerClaimState(
		manager: EntityManager,
		communityScannerId: string
	): Promise<Omit<
		CommunityScannerClaimState,
		'activeJobs' | 'maxActiveJobs'
	> | null> {
		const rows = extractQueryRows(
			(await manager.query(
				`
				select
					(
						is_blacklisted = true
						or (blacklisted_until is not null and blacklisted_until > now())
					) as "isBlocked",
					success_rate as "successRate",
					total_jobs_completed as "totalJobsCompleted",
					total_jobs_failed as "totalJobsFailed"
				from community_scanners
				where id = $1
				for update
				`,
				[communityScannerId]
			)) as RawQueryResult
		) as RawCommunityScannerClaimStateRow[];
		const row = rows[0];
		if (row === undefined) return null;

		return {
			isBlocked: readBoolean(row.isBlocked ?? row.isblocked, 'isBlocked'),
			successRate: readFiniteNumber(
				row.successRate ?? row.successrate,
				'successRate'
			),
			totalJobsCompleted: requireNumber(
				row.totalJobsCompleted ?? row.totaljobscompleted,
				'totalJobsCompleted'
			),
			totalJobsFailed: requireNumber(
				row.totalJobsFailed ?? row.totaljobsfailed,
				'totalJobsFailed'
			)
		};
	}

	private async countActiveCommunityScannerJobs(
		manager: EntityManager,
		communityScannerId: string,
		staleTakenBefore: Date
	): Promise<number> {
		const rows = extractQueryRows(
			(await manager.query(
				`
				select count(*) as "activeJobs"
				from history_archive_scan_job_queue
				where status = 'TAKEN'
					and "claimedByCommunityScannerId" = $1
					and "updatedAt" >= $2
				`,
				[communityScannerId, staleTakenBefore]
			)) as RawQueryResult
		) as RawActiveCommunityScannerJobsRow[];
		const row = rows[0];

		return requireNumber(row?.activeJobs ?? row?.activejobs, 'activeJobs');
	}

	async findActiveByUrl(url: string, limit: number): Promise<ScanJob[]> {
		return this.baseRepository
			.createQueryBuilder('job')
			.where('job.url = :url', { url })
			.andWhere('job.status in (:...statuses)', {
				statuses: ['TAKEN', 'PENDING']
			})
			.orderBy("case when job.status = 'TAKEN' then 0 else 1 end", 'ASC')
			.addOrderBy('job.updatedAt', 'DESC')
			.addOrderBy('job.createdAt', 'DESC')
			.limit(limit)
			.getMany();
	}

	private async claimNextPendingJob(
		manager: EntityManager,
		communityScannerId: string | null
	): Promise<RawScanJobRow[]> {
		await manager.query('select pg_advisory_xact_lock(hashtext($1))', [
			claimLockName
		]);

		const result = (await manager.query(
			`
			update history_archive_scan_job_queue
			set status = 'TAKEN',
				"claimedByCommunityScannerId" = $1,
				"claimedAt" = now(),
				"updatedAt" = now()
			where id = (
				select candidate.id
				from history_archive_scan_job_queue candidate
				where candidate.status = 'PENDING'
					and (
						select count(*)
						from history_archive_scan_job_queue active
						where active.status = 'TAKEN'
							and lower(
								coalesce(
									substring(
										active.url from '^[a-z][a-z0-9+.-]*://([^/?#:]+)'
									),
									active.url
								)
							) = lower(
								coalesce(
									substring(
										candidate.url from '^[a-z][a-z0-9+.-]*://([^/?#:]+)'
									),
									candidate.url
				)
			)
					) < $2
				order by
					candidate."updatedAt" asc,
					candidate.id asc
				for update skip locked
				limit 1
			)
			returning
				id as "id",
				"remoteId" as "remoteId",
				url as "url",
				"latestScannedLedger" as "latestScannedLedger",
				"latestScannedLedgerHeaderHash" as "latestScannedLedgerHeaderHash",
				"chainInitDate" as "chainInitDate",
				"fromLedger" as "fromLedger",
				"toLedger" as "toLedger",
				concurrency as "concurrency",
				"claimedByCommunityScannerId" as "claimedByCommunityScannerId",
				"claimedAt" as "claimedAt",
				status as "status",
				"createdAt" as "createdAt",
				"updatedAt" as "updatedAt"
		`,
			[communityScannerId, maxActiveTakenJobsPerArchiveHost]
		)) as RawQueryResult;

		return extractQueryRows(result);
	}

	async hasPendingJobs(): Promise<boolean> {
		return (
			(await this.baseRepository.count({ where: { status: 'PENDING' } })) > 0
		);
	}

	findByRemoteId(remoteId: string): Promise<ScanJob | null> {
		return this.baseRepository.findOne({ where: { remoteId } });
	}

	findUnfinishedJobs(afterUpdatedAt: Date): Promise<ScanJob[]> {
		return this.baseRepository.find({
			where: [
				{ status: 'TAKEN', updatedAt: MoreThan(afterUpdatedAt) },
				{ status: 'PENDING' }
			]
		});
	}

	async getQueueStats(staleTakenBefore: Date): Promise<ArchiveScanQueueStats> {
		const row = await this.baseRepository
			.createQueryBuilder('job')
			.select("count(*) filter (where job.status = 'PENDING')", 'pendingJobs')
			.addSelect(
				`count(*) filter (
					where job.status = 'TAKEN'
					and job."updatedAt" >= :staleTakenBefore
				)`,
				'activeJobs'
			)
			.addSelect(
				`count(*) filter (
					where job.status = 'TAKEN'
					and job."updatedAt" < :staleTakenBefore
				)`,
				'staleJobs'
			)
			.addSelect(
				"count(*) filter (where job.status in ('PENDING', 'TAKEN'))",
				'totalUnfinishedJobs'
			)
			.setParameter('staleTakenBefore', staleTakenBefore)
			.getRawOne<RawQueueStatsRow>();

		return {
			pendingJobs: requireNumber(
				row?.pendingJobs ?? row?.pendingjobs,
				'pendingJobs'
			),
			activeJobs: requireNumber(
				row?.activeJobs ?? row?.activejobs,
				'activeJobs'
			),
			staleJobs: requireNumber(row?.staleJobs ?? row?.stalejobs, 'staleJobs'),
			totalUnfinishedJobs: requireNumber(
				row?.totalUnfinishedJobs ?? row?.totalunfinishedjobs,
				'totalUnfinishedJobs'
			)
		};
	}

	async getTakenJobsSnapshot(
		staleTakenBefore: Date,
		limit: number
	): Promise<ArchiveScanTakenJobsSnapshot> {
		const [row, jobs] = await Promise.all([
			this.baseRepository
				.createQueryBuilder('job')
				.select(
					`count(*) filter (
						where job.status = 'TAKEN'
						and job."updatedAt" >= :staleTakenBefore
					)`,
					'activeTakenJobs'
				)
				.addSelect(
					`count(*) filter (
						where job.status = 'TAKEN'
						and job."updatedAt" < :staleTakenBefore
					)`,
					'staleTakenJobs'
				)
				.addSelect(
					"count(*) filter (where job.status = 'TAKEN')",
					'totalTakenJobs'
				)
				.setParameter('staleTakenBefore', staleTakenBefore)
				.getRawOne<RawTakenJobStatsRow>(),
			this.baseRepository
				.createQueryBuilder('job')
				.where('job.status = :status', { status: 'TAKEN' })
				.orderBy('job.updatedAt', 'ASC')
				.addOrderBy('job.createdAt', 'ASC')
				.limit(limit)
				.getMany()
		]);

		return {
			activeTakenJobs: requireNumber(
				row?.activeTakenJobs ?? row?.activetakenjobs,
				'activeTakenJobs'
			),
			staleTakenJobs: requireNumber(
				row?.staleTakenJobs ?? row?.staletakenjobs,
				'staleTakenJobs'
			),
			totalTakenJobs: requireNumber(
				row?.totalTakenJobs ?? row?.totaltakenjobs,
				'totalTakenJobs'
			),
			jobs
		};
	}

	async markTakenJobActive(
		remoteId: string,
		progress?: ScanJobProgressUpdate
	): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set(createTakenJobUpdate(progress))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'TAKEN' })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async markTakenJobActiveForCommunityScanner(
		remoteId: string,
		communityScannerId: string,
		progress?: ScanJobProgressUpdate
	): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set(createTakenJobUpdate(progress))
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('"claimedByCommunityScannerId" = :communityScannerId', {
				communityScannerId
			})
			.andWhere('status = :status', { status: 'TAKEN' })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async releaseTakenJob(remoteId: string): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({
				status: 'PENDING',
				claimedByCommunityScannerId: null,
				claimedAt: null,
				updatedAt: () => 'now()'
			})
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('"claimedByCommunityScannerId" is null')
			.andWhere('status = :status', { status: 'TAKEN' })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async releaseStaleTakenJobs(before: Date): Promise<number> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({
				status: 'PENDING',
				claimedByCommunityScannerId: null,
				claimedAt: null,
				updatedAt: () => 'now()'
			})
			.where('status = :status', { status: 'TAKEN' })
			.andWhere('"updatedAt" < :before', { before })
			.execute();

		return result.affected ?? 0;
	}
}

function createTakenJobUpdate(
	progress?: ScanJobProgressUpdate
): QueryDeepPartialEntity<ScanJob> {
	const update: QueryDeepPartialEntity<ScanJob> = { updatedAt: () => 'now()' };
	if (progress === undefined) return update;

	if (progress.concurrency !== undefined)
		update.concurrency = progress.concurrency;
	if (progress.fromLedger !== undefined)
		update.fromLedger = progress.fromLedger;
	if (progress.toLedger !== undefined) update.toLedger = progress.toLedger;
	if (progress.latestScannedLedger !== undefined) {
		update.latestScannedLedger = progress.latestScannedLedger;
	}
	if (progress.latestScannedLedgerHeaderHash !== undefined) {
		update.latestScannedLedgerHeaderHash =
			progress.latestScannedLedgerHeaderHash;
	}

	return update;
}

function readBoolean(value: unknown, field: string): boolean {
	if (typeof value === 'boolean') return value;
	if (value === 'true') return true;
	if (value === 'false') return false;

	throw new Error(`Community scanner row is missing boolean field ${field}`);
}

function readFiniteNumber(
	value: NumericValue | undefined,
	field: string
): number {
	if (value === undefined) {
		throw new Error(`Community scanner row is missing numeric field ${field}`);
	}

	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`Community scanner row is missing numeric field ${field}`);
	}

	return parsed;
}
