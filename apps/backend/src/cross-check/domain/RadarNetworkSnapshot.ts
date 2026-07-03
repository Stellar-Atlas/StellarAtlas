import type { Result } from 'neverthrow';

export type RadarNetworkSnapshotFailureKind =
	| 'http_status'
	| 'invalid_json'
	| 'invalid_payload'
	| 'max_bytes_exceeded'
	| 'network_error'
	| 'timeout';

export interface RadarNetworkSnapshotFailureDTO {
	readonly kind: RadarNetworkSnapshotFailureKind;
	readonly limitBytes?: number;
	readonly message: string;
	readonly status?: number;
}

export interface RadarNetworkFetchOptions {
	readonly maxBytes?: number;
	readonly timeoutMs?: number;
}

export interface RadarNetworkNodeDTO {
	readonly active: boolean | null;
	readonly activeInScp: boolean | null;
	readonly alias: string | null;
	readonly connectivityError: boolean | null;
	readonly historyArchiveHasError: boolean | null;
	readonly historyUrl: string | null;
	readonly homeDomain: string | null;
	readonly host: string | null;
	readonly index: number | null;
	readonly isFullValidator: boolean | null;
	readonly isValidating: boolean | null;
	readonly isValidator: boolean | null;
	readonly lag: number | null;
	readonly name: string | null;
	readonly organizationId: string | null;
	readonly publicKey: string;
	readonly quorumSetHashKey: string | null;
	readonly stellarCoreVersionBehind: boolean | null;
	readonly versionStr: string | null;
}

export interface RadarNetworkOrganizationDTO {
	readonly homeDomain: string | null;
	readonly horizonUrl: string | null;
	readonly id: string;
	readonly name: string | null;
	readonly tomlState: string | null;
	readonly url: string | null;
	readonly validators: readonly string[];
}

export interface RadarNetworkSnapshotDTO {
	readonly contentHashSha256: string;
	readonly endpointUrl: string;
	readonly fetchedAt: string;
	readonly latestLedger: string | null;
	readonly networkId: string | null;
	readonly networkName: string | null;
	readonly networkTime: string | null;
	readonly nodes: readonly RadarNetworkNodeDTO[];
	readonly organizations: readonly RadarNetworkOrganizationDTO[];
	readonly sourceId: 'withobsrvr-radar';
	readonly warnings: readonly string[];
}

export interface CrossCheckRadarNetworkSnapshotSource {
	fetchNetworkSnapshot(
		options?: RadarNetworkFetchOptions
	): Promise<Result<RadarNetworkSnapshotDTO, RadarNetworkSnapshotFailureDTO>>;
}

export function radarNetworkSnapshotFailure(
	kind: RadarNetworkSnapshotFailureKind,
	message: string,
	extras: Omit<RadarNetworkSnapshotFailureDTO, 'kind' | 'message'> = {}
): RadarNetworkSnapshotFailureDTO {
	return {
		...extras,
		kind,
		message
	};
}
