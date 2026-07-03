import { LessThan, LessThanOrEqual, Repository } from 'typeorm';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { injectable } from 'inversify';
import type {
	NetworkScanRepository,
	NetworkScanSummary
} from '@network-scan/domain/network/scan/NetworkScanRepository.js';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import { Measurement } from '@network-scan/domain/measurement/Measurement.js';

@injectable()
export class TypeOrmNetworkScanRepository implements NetworkScanRepository {
	constructor(private repository: Repository<NetworkScan>) {}

	async findLatestSuccessfulScanTime(): Promise<Date | undefined> {
		const scan = await this.repository.findOne({
			select: ['time'],
			where: {
				completed: true
			},
			order: {
				time: 'DESC'
			}
		});
		if (!scan) return undefined;

		return scan.time;
	}

	async findScanSummary(from: Date, to: Date): Promise<NetworkScanSummary> {
		const row = await this.repository
			.createQueryBuilder('scan')
			.select('COUNT(scan.id)', 'totalScans')
			.addSelect(
				'SUM(CASE WHEN scan.completed = true THEN 1 ELSE 0 END)',
				'completedScans'
			)
			.addSelect('MAX(scan.time)', 'latestScanAt')
			.addSelect(
				'MAX(CASE WHEN scan.completed = true THEN scan.time ELSE NULL END)',
				'latestCompletedScanAt'
			)
			.where('scan.time >= :from', { from })
			.andWhere('scan.time <= :to', { to })
			.getRawOne<{
				totalScans?: string | number | null;
				totalscans?: string | number | null;
				completedScans?: string | number | null;
				completedscans?: string | number | null;
				latestScanAt?: string | Date | null;
				latestscanat?: string | Date | null;
				latestCompletedScanAt?: string | Date | null;
				latestcompletedscanat?: string | Date | null;
			}>();

		const totalScans = Number(row?.totalScans ?? row?.totalscans ?? 0);
		const completedScans = Number(
			row?.completedScans ?? row?.completedscans ?? 0
		);

		return {
			totalScans,
			completedScans,
			latestScanAt: toNullableDate(row?.latestScanAt ?? row?.latestscanat),
			latestCompletedScanAt: toNullableDate(
				row?.latestCompletedScanAt ?? row?.latestcompletedscanat
			)
		};
	}

	async findLatest(): Promise<NetworkScan | undefined> {
		const scan = await this.repository.findOne({
			where: {
				completed: true
			},
			order: {
				time: 'DESC'
			}
		});
		if (!scan) return undefined;

		const measurement = await this.repository.manager.findOne(
			NetworkMeasurement,
			{
				where: { time: scan?.time }
			}
		);

		scan.measurement = measurement ?? null;

		return scan;
	}

	async findAt(at: Date): Promise<NetworkScan | undefined> {
		const scan = await this.repository.findOne({
			where: { time: LessThanOrEqual(at), completed: true },
			order: { time: 'DESC' }
		});

		if (!scan) return undefined;

		const measurement = await this.repository.manager.findOne(
			NetworkMeasurement,
			{
				where: { time: scan?.time }
			}
		);

		scan.measurement = measurement ?? null;

		return scan;
	}

	async findPreviousAt(at: Date): Promise<NetworkScan | undefined> {
		const scan = await this.repository.findOne({
			where: { time: LessThan(at), completed: true },
			order: { time: 'DESC' }
		});

		if (!scan) return undefined;

		const measurement = await this.repository.manager.findOne(
			NetworkMeasurement,
			{
				where: { time: scan?.time }
			}
		);

		scan.measurement = measurement ?? null;

		return scan;
	}

	async saveOne(scan: NetworkScan): Promise<NetworkScan> {
		if (!scan.measurement) throw new Error('Measurement is not set');
		await this.repository.manager.save(NetworkMeasurement, scan.measurement);
		return this.repository.save(scan);
	}

	async save(scans: NetworkScan[]): Promise<NetworkScan[]> {
		const measurements: Measurement[] = [];
		for (const scan of scans) {
			if (!scan.measurement) throw new Error('Measurement is not set');
			measurements.push(scan.measurement);
		}
		await this.repository.manager.save(NetworkMeasurement, measurements);
		return this.repository.save(scans);
	}
}

function toNullableDate(value: Date | string | null | undefined): Date | null {
	if (!value) return null;
	return value instanceof Date ? value : new Date(value);
}
