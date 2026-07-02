import { injectable } from 'inversify';
import type { ScanJobRepository } from '../../../domain/ScanJobRepository.js';
import { ScanJob } from '../../../domain/ScanJob.js';
import { EntityManager, MoreThan, Repository } from 'typeorm';

type ScanJobRow = {
	id: number;
	remoteId: string;
	url: string;
	latestScannedLedger: number;
	latestScannedLedgerHeaderHash: string | null;
	chainInitDate: Date | null;
	fromLedger: number | null;
	toLedger: number | null;
	concurrency: number | null;
	status: 'PENDING' | 'TAKEN' | 'DONE';
	createdAt: Date;
	updatedAt: Date;
};

@injectable()
export class TypeOrmScanJobRepository implements ScanJobRepository {
	constructor(private baseRepository: Repository<ScanJob>) {}

	async save(scanJobs: ScanJob[]): Promise<void> {
		await this.baseRepository.save(scanJobs);
	}

	async fetchNextJob(): Promise<ScanJob | null> {
		return await this.baseRepository.manager.transaction(async (manager) => {
			const rows = await this.claimNextPendingJob(manager);
			const row = rows[0];
			if (row === undefined) return null;

			return manager.getRepository(ScanJob).create(row);
		});
	}

	private async claimNextPendingJob(
		manager: EntityManager
	): Promise<ScanJobRow[]> {
		return (await manager.query(`
			update history_archive_scan_job_queue
			set status = 'TAKEN',
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
				id,
				"remoteId",
				url,
				"latestScannedLedger",
				"latestScannedLedgerHeaderHash",
				"chainInitDate",
				"fromLedger",
				"toLedger",
				concurrency,
				status,
				"createdAt",
				"updatedAt"
		`)) as ScanJobRow[];
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

	async releaseStaleTakenJobs(before: Date): Promise<number> {
		const result = await this.baseRepository
			.createQueryBuilder()
			.update(ScanJob)
			.set({ status: 'PENDING' })
			.where('status = :status', { status: 'TAKEN' })
			.andWhere('"updatedAt" < :before', { before })
			.execute();

		return result.affected ?? 0;
	}
}
