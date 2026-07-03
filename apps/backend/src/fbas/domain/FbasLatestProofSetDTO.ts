import type {
	FbasCaptureLimits,
	FbasProofSetFamily
} from '@network-scan/domain/network/scan/fbas-analysis/FbasProofPayload.js';

export type FbasLatestProofSetEvidenceSelection =
	'latest_network_scan_fbas_proof';

export interface FbasLatestProofSetBaseDTO {
	readonly generatedAt: string;
	readonly evidenceSelection: FbasLatestProofSetEvidenceSelection;
	readonly proofSetPersistence: 'persisted';
	readonly scanId: number;
	readonly scanTime: string;
	readonly schemaVersion: number;
	readonly payloadBytes: number;
	readonly limits: FbasCaptureLimits;
	readonly complete: boolean;
}

export interface FbasBlockingSetDimensionDTO {
	readonly blockingSets: FbasProofSetFamily;
	readonly blockingSetsFiltered: FbasProofSetFamily;
}

export interface FbasSplittingSetDimensionDTO {
	readonly splittingSets: FbasProofSetFamily;
}

export interface FbasBlockingSetsDTO extends FbasLatestProofSetBaseDTO {
	readonly setType: 'blocking_sets';
	readonly node: FbasBlockingSetDimensionDTO;
	readonly organization: FbasBlockingSetDimensionDTO;
	readonly country: FbasBlockingSetDimensionDTO;
	readonly isp: FbasBlockingSetDimensionDTO;
}

export interface FbasSplittingSetsDTO extends FbasLatestProofSetBaseDTO {
	readonly setType: 'splitting_sets';
	readonly node: FbasSplittingSetDimensionDTO;
	readonly organization: FbasSplittingSetDimensionDTO;
	readonly country: FbasSplittingSetDimensionDTO;
	readonly isp: FbasSplittingSetDimensionDTO;
}

export type FbasLatestProofSetDTO = FbasBlockingSetsDTO | FbasSplittingSetsDTO;
