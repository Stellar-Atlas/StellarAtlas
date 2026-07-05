export const scanEvidenceKinds = ['bucket'] as const;
export const scanEvidenceStatuses = ['verified'] as const;

export type ScanEvidenceKindDTO = (typeof scanEvidenceKinds)[number];
export type ScanEvidenceStatusDTO = (typeof scanEvidenceStatuses)[number];

export interface ScanEvidenceDTO {
	readonly bucketHash: string;
	readonly kind: ScanEvidenceKindDTO;
	readonly status: ScanEvidenceStatusDTO;
	readonly url: string;
}

const bucketHashPattern = /^[a-f0-9]{64}$/i;

export function isScanEvidenceDTO(value: unknown): value is ScanEvidenceDTO {
	if (typeof value !== 'object' || value === null) return false;

	const candidate = value as Record<string, unknown>;
	return (
		candidate.kind === 'bucket' &&
		candidate.status === 'verified' &&
		typeof candidate.bucketHash === 'string' &&
		bucketHashPattern.test(candidate.bucketHash) &&
		typeof candidate.url === 'string'
	);
}
