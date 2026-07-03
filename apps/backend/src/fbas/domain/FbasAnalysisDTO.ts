import type { FbasScanMeasurementDTO } from './FbasScanMeasurementDTO.js';
import type { FbasProofSetPersistence } from './LatestFbasDTO.js';

export type FbasAnalysisEvidenceSelection =
	'completed_network_scan_measurement';

export interface FbasAnalysisDTO extends FbasScanMeasurementDTO {
	readonly generatedAt: string;
	readonly evidenceSelection: FbasAnalysisEvidenceSelection;
	readonly proofSetPersistence: Extract<
		FbasProofSetPersistence,
		'not_persisted'
	>;
}
