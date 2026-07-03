import type { Repository } from 'typeorm';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import { TypeOrmNetworkScanRepository } from '../TypeOrmNetworkScanRepository.js';

describe('TypeOrmNetworkScanRepository', () => {
	it('should save a scan proof artifact after the scan id is assigned', async () => {
		const scan = new NetworkScan(new Date('2026-07-03T12:00:00.000Z'));
		scan.measurement = new NetworkMeasurement(scan.time);
		const fbasProof = new NetworkScanFbasProof();
		scan.fbasProof = fbasProof;
		const savedScan = new NetworkScan(scan.time);
		savedScan.id = 42;
		const repositoryMock = makeRepositoryMock();
		repositoryMock.save.mockResolvedValue(savedScan);
		const repository = new TypeOrmNetworkScanRepository(
			repositoryMock as unknown as Repository<NetworkScan>
		);

		const result = await repository.saveOne(scan);

		expect(result).toBe(savedScan);
		expect(repositoryMock.manager.save).toHaveBeenNthCalledWith(
			1,
			NetworkMeasurement,
			scan.measurement
		);
		expect(repositoryMock.save).toHaveBeenCalledWith(scan);
		expect(fbasProof.scanId).toBe(42);
		expect(fbasProof.scanTime).toBe(savedScan.time);
		expect(repositoryMock.manager.save).toHaveBeenNthCalledWith(
			2,
			NetworkScanFbasProof,
			fbasProof
		);
	});

	it('should find a completed scan by id and hydrate its measurement', async () => {
		const scan = new NetworkScan(new Date('2026-07-03T12:00:00.000Z'));
		scan.id = 42;
		scan.completed = true;
		const measurement = new NetworkMeasurement(scan.time);
		const repositoryMock = makeRepositoryMock();
		repositoryMock.findOne.mockResolvedValue(scan);
		repositoryMock.manager.findOne.mockResolvedValue(measurement);
		const repository = new TypeOrmNetworkScanRepository(
			repositoryMock as unknown as Repository<NetworkScan>
		);

		const result = await repository.findCompletedById(42);

		expect(repositoryMock.findOne).toHaveBeenCalledWith({
			where: {
				completed: true,
				id: 42
			}
		});
		expect(repositoryMock.manager.findOne).toHaveBeenCalledWith(
			NetworkMeasurement,
			{
				where: { time: scan.time }
			}
		);
		expect(result).toBe(scan);
		expect(result?.measurement).toBe(measurement);
	});

	it('should return undefined when no completed scan matches the id', async () => {
		const repositoryMock = makeRepositoryMock();
		repositoryMock.findOne.mockResolvedValue(null);
		const repository = new TypeOrmNetworkScanRepository(
			repositoryMock as unknown as Repository<NetworkScan>
		);

		const result = await repository.findCompletedById(42);

		expect(result).toBeUndefined();
		expect(repositoryMock.manager.findOne).not.toHaveBeenCalled();
	});
});

function makeRepositoryMock() {
	return {
		findOne: jest.fn(),
		save: jest.fn(),
		manager: {
			findOne: jest.fn(),
			save: jest.fn()
		}
	};
}
