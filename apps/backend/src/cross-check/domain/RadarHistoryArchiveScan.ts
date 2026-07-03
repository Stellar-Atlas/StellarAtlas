import type { Result } from 'neverthrow';

export type RadarHistoryArchiveScanFailureKind =
	| 'http_status'
	| 'invalid_archive_url'
	| 'invalid_json'
	| 'invalid_payload'
	| 'max_bytes_exceeded'
	| 'network_error'
	| 'timeout';

export interface RadarHistoryArchiveScanFailureDTO {
	readonly kind: RadarHistoryArchiveScanFailureKind;
	readonly limitBytes?: number;
	readonly message: string;
	readonly status?: number;
}

export interface RadarHistoryArchiveScanDTO {
	readonly contentHashSha256: string;
	readonly endDate: string;
	readonly endpointUrl: string;
	readonly errorMessage: string | null;
	readonly errorUrl: string | null;
	readonly fetchedAt: string;
	readonly hasError: boolean;
	readonly isSlow: boolean | null;
	readonly latestVerifiedLedger: number | null;
	readonly sourceId: 'withobsrvr-radar';
	readonly startDate: string;
	readonly url: string;
}

export interface RadarHistoryArchiveScanFetchOptions {
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}

export interface CrossCheckRadarHistoryArchiveScanSource {
	fetchHistoryArchiveScan(
		archiveUrl: string,
		options?: RadarHistoryArchiveScanFetchOptions
	): Promise<
		Result<RadarHistoryArchiveScanDTO | null, RadarHistoryArchiveScanFailureDTO>
	>;
}

export function radarHistoryArchiveScanFailure(
	kind: RadarHistoryArchiveScanFailureKind,
	message: string,
	extras: Omit<RadarHistoryArchiveScanFailureDTO, 'kind' | 'message'> = {}
): RadarHistoryArchiveScanFailureDTO {
	return {
		...extras,
		kind,
		message
	};
}
