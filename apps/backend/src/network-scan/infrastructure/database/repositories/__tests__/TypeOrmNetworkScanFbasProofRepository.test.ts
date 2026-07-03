import type { Repository } from 'typeorm';
import { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import { TypeOrmNetworkScanFbasProofRepository } from '../TypeOrmNetworkScanFbasProofRepository.js';

describe('TypeOrmNetworkScanFbasProofRepository', () => {
	it('should find a proof artifact by scan id', async () => {
		const proof = new NetworkScanFbasProof();
		const repositoryMock = {
			findOne: jest.fn().mockResolvedValue(proof)
		};
		const repository = new TypeOrmNetworkScanFbasProofRepository(
			repositoryMock as unknown as Repository<NetworkScanFbasProof>
		);

		const result = await repository.findByScanId(42);

		expect(result).toBe(proof);
		expect(repositoryMock.findOne).toHaveBeenCalledWith({
			where: {
				scanId: 42
			}
		});
	});
});
