export type RadarApiDocsFailureKind =
	| 'http_status'
	| 'invalid_openapi'
	| 'max_bytes_exceeded'
	| 'network_error'
	| 'parse_error'
	| 'timeout'
	| 'unsupported_shape';

export interface RadarApiDocsFailureDTO {
	readonly kind: RadarApiDocsFailureKind;
	readonly limitBytes?: number;
	readonly message: string;
	readonly status?: number;
}

export type RadarApiOperationMethod =
	'delete' | 'get' | 'head' | 'options' | 'patch' | 'post' | 'put' | 'trace';

export interface RadarApiServerDTO {
	readonly description: string | null;
	readonly url: string;
}

export interface RadarApiOperationDTO {
	readonly method: RadarApiOperationMethod;
	readonly operationId: string | null;
	readonly path: string;
	readonly schemaRefs: readonly string[];
	readonly summary: string | null;
	readonly tags: readonly string[];
}

export interface RadarApiDocsSnapshotDTO {
	readonly assetUrl: string;
	readonly contentHashSha256: string;
	readonly documentationUrl: string;
	readonly fetchedAt: string;
	readonly openapiVersion: string;
	readonly operations: readonly RadarApiOperationDTO[];
	readonly servers: readonly RadarApiServerDTO[];
	readonly sourceId: 'withobsrvr-radar';
	readonly title: string;
	readonly version: string;
	readonly warnings: readonly string[];
}

export function radarApiDocsFailure(
	kind: RadarApiDocsFailureKind,
	message: string,
	extras: Omit<RadarApiDocsFailureDTO, 'kind' | 'message'> = {}
): RadarApiDocsFailureDTO {
	return {
		...extras,
		kind,
		message
	};
}
