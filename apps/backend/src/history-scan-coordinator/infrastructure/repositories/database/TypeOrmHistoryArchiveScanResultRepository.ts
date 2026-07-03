import type { ScanRepository } from '@history-scan-coordinator/domain/scan/ScanRepository.js';
import { Repository } from 'typeorm';
import { Scan } from '@history-scan-coordinator/domain/scan/Scan.js';
import { injectable } from 'inversify';

type NumericValue = number | string;
type RawLatestScanIdRow = { id?: NumericValue };
type ScanWithId = Scan & { id: number };

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

		return (
			latestVerificationScan ??
			(await this.createFindByUrlQuery(url)
				.orderBy('scan.startDate', 'DESC')
				.getOne())
		);
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

	async findLatestLimited(limit: number): Promise<Scan[]> {
		if (!Number.isSafeInteger(limit) || limit < 1) return [];

		const scanIds = await this.findLatestScanIds(limit);
		if (scanIds.length === 0) return [];

		const scans = await this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.id in (:...scanIds)', { scanIds })
			.leftJoinAndSelect('scan.error', 'error')
			.getMany();
		const scansById = new Map(
			scans.map((scan) => [(scan as ScanWithId).id, scan])
		);

		return scanIds.map((id) => {
			const scan = scansById.get(id);
			if (scan === undefined) {
				throw new Error('Latest history archive scan row was not found');
			}

			return scan;
		});
	}

	async findLatest(): Promise<Scan[]> {
		const latestScans = await this.findLatestScans(false);
		const latestVerificationScans = await this.findLatestScans(true);
		const latestVerificationScansByUrl = new Map(
			latestVerificationScans.map((scan) => [scan.baseUrl.value, scan])
		);

		return latestScans.map(
			(scan) => latestVerificationScansByUrl.get(scan.baseUrl.value) ?? scan
		);
	}

	private createFindByUrlQuery(url: string) {
		return this.baseRepository
			.createQueryBuilder('scan')
			.where('scan.url=:url', { url })
			.leftJoinAndSelect('scan.error', 'error');
	}

	private async findLatestScanIds(limit: number): Promise<number[]> {
		const rows = (await this.baseRepository.query(
			`
				with latest_scan as (
					select distinct on (url)
						id,
						url,
						"startDate"
					from history_archive_scan_v2
					order by url, "startDate" desc, id desc
				),
				latest_verification_scan as (
					select distinct on (url)
						id,
						url,
						"startDate"
					from history_archive_scan_v2
					where concurrency > 0
					order by url, "startDate" desc, id desc
				),
				selected_scan as (
					select
						coalesce(latest_verification_scan.id, latest_scan.id) as id,
						coalesce(
							latest_verification_scan."startDate",
							latest_scan."startDate"
						) as "selectedStartDate"
					from latest_scan
					left join latest_verification_scan
						on latest_verification_scan.url = latest_scan.url
				)
				select id
				from selected_scan
				order by "selectedStartDate" desc, id desc
				limit $1
			`,
			[limit]
		)) as RawLatestScanIdRow[];

		return rows.map((row) => this.requireNumber(row.id, 'id'));
	}

	private requireNumber(
		value: NumericValue | undefined,
		field: string
	): number {
		if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
		if (typeof value === 'string' && /^\d+$/.test(value)) {
			const parsed = Number(value);
			if (Number.isSafeInteger(parsed)) return parsed;
		}

		throw new Error(
			`History archive scan row is missing numeric field ${field}`
		);
	}

	private async findLatestScans(
		verificationScansOnly: boolean
	): Promise<Scan[]> {
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
