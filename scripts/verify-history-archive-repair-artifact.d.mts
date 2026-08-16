export interface HistoryArchiveRepairArtifactVerificationOptions {
	readonly expectedByteLength?: number | null;
	readonly expectedDigest: string;
	readonly filePath: string;
	readonly maxCompressedBytes?: number;
	readonly maxJsonBytes?: number;
	readonly maxUncompressedBytes?: number;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export interface HistoryArchiveRepairArtifactVerificationResult {
	readonly byteLength: number;
	readonly digest: string;
	readonly representation: 'canonical-json' | 'uncompressed-xdr';
}

export function verifyHistoryArchiveRepairArtifact(
	options: HistoryArchiveRepairArtifactVerificationOptions
): Promise<HistoryArchiveRepairArtifactVerificationResult>;
