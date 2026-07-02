import { LessThan, LessThanOrEqual, Repository } from 'typeorm';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { injectable } from 'inversify';
import type { NetworkScanRepository } from '@network-scan/domain/network/scan/NetworkScanRepository.js';
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
