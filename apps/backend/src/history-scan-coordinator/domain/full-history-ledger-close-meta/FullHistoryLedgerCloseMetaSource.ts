export const SEP54_ZSTD_COMPRESSION = 'zstd' as const;

export interface Sep54LedgerCloseMetaConfig {
	readonly batchesPerPartition: number;
	readonly compression: typeof SEP54_ZSTD_COMPRESSION;
	readonly ledgersPerBatch: number;
	readonly networkPassphrase: string;
	readonly version: string;
}

export interface FullHistoryLedgerCloseMetaSourceDescriptor {
	readonly ledgersPath: string;
	readonly sourceUri: string;
}

export interface FullHistoryLedgerCloseMetaSourceObjectIdentity {
	readonly etag?: string;
	readonly generation: string;
	readonly objectKey: string;
	readonly sourceUri: string;
}

export interface FullHistoryLedgerCloseMetaSourceObject {
	readonly bytes: Uint8Array;
	readonly identity: FullHistoryLedgerCloseMetaSourceObjectIdentity;
}

export type FullHistoryLedgerCloseMetaSourceReadResult =
	| {
			readonly object: FullHistoryLedgerCloseMetaSourceObject;
			readonly status: 'found';
	  }
	| { readonly status: 'not-found' };
