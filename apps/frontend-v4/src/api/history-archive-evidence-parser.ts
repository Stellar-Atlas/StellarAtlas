import type { PublicHistoryArchiveEvidence } from './archive-evidence-types';

export function parseHistoryArchiveEvidence(
	value: unknown
): PublicHistoryArchiveEvidence {
	if (
		!isRecord(value) ||
		typeof value.generatedAt !== 'string' ||
		!isRecord(value.root) ||
		!Array.isArray(value.root.nodePublicKeys) ||
		!isRecord(value.eventPage) ||
		!isRecord(value.objectPage) ||
		!isRecord(value.remoteFailures) ||
		!isRecord(value.workerIssues)
	) {
		throw new Error('Archive evidence response did not match the v2 contract');
	}

	return value as unknown as PublicHistoryArchiveEvidence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
