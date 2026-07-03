import type { Repository } from 'typeorm';
import { NetworkScanFbasProof } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProof.js';
import type { NetworkScanFbasProofRepository } from '@network-scan/domain/network/scan/fbas-analysis/NetworkScanFbasProofRepository.js';

export class TypeOrmNetworkScanFbasProofRepository implements NetworkScanFbasProofRepository {
	constructor(private readonly repository: Repository<NetworkScanFbasProof>) {}

	findByScanId(scanId: number): Promise<NetworkScanFbasProof | null> {
		return this.repository.findOne({
			where: {
				scanId
			}
		});
	}
}
