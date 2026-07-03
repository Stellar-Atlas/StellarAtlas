import { injectable } from 'inversify';
import type {
	ArchiveScanQueueStats,
	ArchiveScanTakenJobsSnapshot,
	ScanJobRepository
} from '@history-scan-coordinator/domain/ScanJobRepository.js';
import { ScanJob } from '@history-scan-coordinator/domain/ScanJob.js';
import { EntityManager, MoreThan, Repository } from 'typeorm';
import {
	createScanJobFromRow,
	extractQueryRows,
	requireNumber,
	type RawQueryResult,
	type RawQueueStatsRow,
	type RawScanJobRow,
	type RawTakenJobStatsRow
} from './ScanJobRowMapper.js';

@injectable()
export class TypeOrmScanJobRepository implements ScanJobRepository {
	constructor(private baseRepository: Repository<ScanJob>) {}

	async save(scanJobs: ScanJob[]): Promise<void> {
		await this.baseRepository.save(scanJobs);
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
		communityScannerId: string
	): Promise<ScanJob | null> {
		return await this.baseRepository.manager.transaction(async (manager) => {
			const rows = await this.claimNextPendingJob(manager, communityScannerId);
			const row = rows[0];
			if (row === undefined) return null;

			return createScanJobFromRow(row);
		});
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
		const result = (await manager.query(
			`
			update history_archive_scan_job_queue
			set status = 'TAKEN',
				"claimedByCommunityScannerId" = $1,
				"claimedAt" = now(),
				"updatedAt" = now()
			where id = (
				select id
				from history_archive_scan_job_queue
				where status = 'PENDING'
				order by
					case when "fromLedger" is null then 1 else 0 end asc,
					id asc
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
			[communityScannerId]
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
				{ status: 'PENDING', updatedAt: MoreThan(afterUpdatedAt) }
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

	async markTakenJobActive(remoteId: string): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({ updatedAt: () => 'now()' })
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('status = :status', { status: 'TAKEN' })
			.execute();

		return (result.affected ?? 0) > 0;
	}

	async markTakenJobActiveForCommunityScanner(
		remoteId: string,
		communityScannerId: string
	): Promise<boolean> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({ updatedAt: () => 'now()' })
			.where('"remoteId" = :remoteId', { remoteId })
			.andWhere('"claimedByCommunityScannerId" = :communityScannerId', {
				communityScannerId
			})
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
				claimedAt: null
			})
			.where('status = :status', { status: 'TAKEN' })
			.andWhere('"updatedAt" < :before', { before })
			.execute();

		return result.affected ?? 0;
	}
}
