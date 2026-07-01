import { injectable } from 'inversify';
import type { ScanJobRepository } from '../../../domain/ScanJobRepository.js';
import { ScanJob } from '../../../domain/ScanJob.js';
import { MoreThan, Repository } from 'typeorm';

@injectable()
export class TypeOrmScanJobRepository implements ScanJobRepository {
	constructor(private baseRepository: Repository<ScanJob>) {}

	async save(scanJobs: ScanJob[]): Promise<void> {
		await this.baseRepository.save(scanJobs);
	}

	async fetchNextJob(): Promise<ScanJob | null> {
		return await this.baseRepository
			.createQueryBuilder('job')
			.where('job.status = :status', { status: 'PENDING' })
			.orderBy('CASE WHEN job."fromLedger" IS NULL THEN 1 ELSE 0 END', 'ASC')
			.addOrderBy('job.id', 'ASC')
			.getOne();
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
}
