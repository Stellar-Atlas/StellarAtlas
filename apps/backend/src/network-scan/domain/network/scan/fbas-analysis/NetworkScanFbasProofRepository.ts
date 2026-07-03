import type { NetworkScanFbasProof } from './NetworkScanFbasProof.js';

export interface NetworkScanFbasProofRepository {
	findByScanId(scanId: number): Promise<NetworkScanFbasProof | null>;
}
