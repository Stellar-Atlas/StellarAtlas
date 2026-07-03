import type { Repository } from 'typeorm';
import NetworkMeasurement from '@network-scan/domain/network/NetworkMeasurement.js';
import NetworkScan from '@network-scan/domain/network/scan/NetworkScan.js';
import { TypeOrmNetworkScanRepository } from '../TypeOrmNetworkScanRepository.js';

describe('TypeOrmNetworkScanRepository', () => {
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
		manager: {
			findOne: jest.fn()
		}
	};
}
