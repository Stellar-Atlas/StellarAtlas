import type { FbasLatestSummaryDTO } from './LatestFbasDTO.js';

export interface FbasScanMeasurementDTO {
	readonly scanId: number;
	readonly scanTime: string;
	readonly latestLedger: string;
	readonly latestLedgerCloseTime: string | null;
	readonly processedLedgers: readonly number[];
	readonly summary: FbasLatestSummaryDTO;
}
