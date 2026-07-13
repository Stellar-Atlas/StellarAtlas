import type {
	HistoryArchiveScanErrorV1,
	HistoryArchiveMetadataV1,
	HistoryArchiveScanV1
} from './dto/history-archive-scan-v1.js';

export type HistoryArchiveScanError = HistoryArchiveScanErrorV1;
export type HistoryArchiveMetadata = HistoryArchiveMetadataV1;

export class HistoryArchiveScan {
	constructor(
		public readonly url: string,
		public readonly startDate: Date,
		public readonly endDate: Date,
		public readonly latestVerifiedLedger: number,
		public readonly hasError: boolean,
		public readonly errorUrl: string | null,
		public readonly errorMessage: string | null,
		public readonly isSlow: boolean,
		public readonly errors: readonly HistoryArchiveScanError[] = [],
		public readonly archiveMetadata: HistoryArchiveMetadata | null = null
	) {}

	static fromHistoryArchiveScanV1(
		historyArchiveScanV1DTO: HistoryArchiveScanV1
	): HistoryArchiveScan {
		return new HistoryArchiveScan(
			historyArchiveScanV1DTO.url,
			new Date(historyArchiveScanV1DTO.startDate),
			new Date(historyArchiveScanV1DTO.endDate),
			historyArchiveScanV1DTO.latestVerifiedLedger,
			historyArchiveScanV1DTO.hasError,
			historyArchiveScanV1DTO.errorUrl,
			historyArchiveScanV1DTO.errorMessage,
			historyArchiveScanV1DTO.isSlow,
			historyArchiveScanV1DTO.errors ?? [],
			historyArchiveScanV1DTO.archiveMetadata ?? null
		);
	}
}
