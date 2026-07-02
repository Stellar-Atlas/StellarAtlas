import type { ScanRepository } from '../../../domain/scan/ScanRepository.js';
import { Repository } from 'typeorm';
import { Scan } from '../../../domain/scan/Scan.js';
import { injectable } from 'inversify';

@injectable()
export class TypeOrmHistoryArchiveScanResultRepository implements ScanRepository {
	constructor(private baseRepository: Repository<Scan>) {}

	async save(scans: Scan[]): Promise<Scan[]> {
		return await this.baseRepository.save(scans);
	}

	async findLatestByUrl(url: string): Promise<Scan | null> {
		return await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.url=:url', { url: url })
			//.andWhere('scan."hasError"=false')
			.leftJoinAndSelect('scan.error', 'error')
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
		return await this.baseRepository
			.createQueryBuilder('ha')
			.innerJoin(
				(qb) =>
					qb
						.select('max(id) id')
						.from('history_archive_scan_v2', 'haj')
						.groupBy('url'),
				'haj',
				'ha.id = haj.id'
			)
			.leftJoinAndSelect('ha.error', 'error')
			.getMany();
	}
}
