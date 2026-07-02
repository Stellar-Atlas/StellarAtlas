import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Repository } from 'typeorm';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { injectable } from 'inversify';

@injectable()
export class TypeOrmHistoryArchiveScanResultRepository implements ScanRepository {
	constructor(private baseRepository: Repository<Scan>) {}

	async save(scans: Scan[]): Promise<Scan[]> {
		return await this.baseRepository.save(scans);
	}

	async findLatestByUrl(url: string): Promise<Scan | null> {
		const latestVerificationScan = await this.createFindByUrlQuery(url)
			.andWhere('scan.concurrency > 0')
			.orderBy('scan.startDate', 'DESC')
			.getOne();

		return latestVerificationScan ?? await this.createFindByUrlQuery(url)
			.orderBy('scan.startDate', 'DESC')
			.getOne();
	}

	async findRecentByUrl(url: string, limit: number): Promise<Scan[]> {
		return await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.url=:url', { url })
			.leftJoinAndSelect('scan.error', 'error')
			.orderBy('scan.startDate', 'DESC')
			.take(limit)
			.getMany();
	}

	async findLatest(): Promise<Scan[]> {
		const latestScans = await this.findLatestScans(false);
		const latestVerificationScans = await this.findLatestScans(true);
		const latestVerificationScansByUrl = new Map(
			latestVerificationScans.map((scan) => [scan.baseUrl.value, scan])
		);

		return latestScans.map((scan) =>
			latestVerificationScansByUrl.get(scan.baseUrl.value) ?? scan
		);
	}

	private createFindByUrlQuery(url: string) {
		return this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.url=:url', { url })
			.leftJoinAndSelect('scan.error', 'error');
	}

	private async findLatestScans(verificationScansOnly: boolean): Promise<Scan[]> {
		return await this.baseRepository
			.createQueryBuilder('ha')
			.innerJoin(
				(qb) => {
					const query = qb
						.select('max(id) id')
						.from('history_archive_scan_v2', 'haj');
					if (verificationScansOnly) query.where('haj.concurrency > 0');
					return query.groupBy('url');
				},
				'haj',
				'ha.id = haj.id'
			)
			.leftJoinAndSelect('ha.error', 'error')
			.getMany();
	}
}
