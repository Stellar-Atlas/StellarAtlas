import type { FbasProofPayload } from '@network-scan/domain/network/scan/fbas-analysis/FbasProofPayload.js';

export type FbasAnalysisProofEvidenceSelection = 'network_scan_fbas_proof';

export interface FbasAnalysisProofDTO {
	readonly generatedAt: string;
	readonly evidenceSelection: FbasAnalysisProofEvidenceSelection;
	readonly proofSetPersistence: 'persisted';
	readonly scanId: number;
	readonly scanTime: string;
	readonly schemaVersion: number;
	readonly payloadBytes: number;
	readonly proof: FbasProofPayload;
}
