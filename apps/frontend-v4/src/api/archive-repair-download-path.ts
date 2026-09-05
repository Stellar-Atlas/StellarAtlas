const artifactPrefix = '/v1/archive-scans/repair-artifacts/';
const proxyPrefix = '/api/archive-repair-artifacts/';
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/i;
const positiveIntegerPattern = /^[1-9][0-9]*$/;

export function getArchiveRepairDownloadPath(
	downloadUrl: string
): string | null {
	if (!downloadUrl.startsWith(artifactPrefix)) return null;
	if (downloadUrl.includes('?') || downloadUrl.includes('#')) return null;
	const suffix = downloadUrl.slice(artifactPrefix.length);
	const segments = suffix.split('/');
	if (!isValidArchiveRepairArtifactPath(segments)) return null;
	return proxyPrefix + segments.map(encodeURIComponent).join('/');
}

export function isValidArchiveRepairArtifactPath(
	segments: readonly string[]
): boolean {
	if (segments[0] === 'buckets') {
		return segments.length === 2 && digestPattern.test(segments[1] ?? '');
	}
	if (segments[0] !== 'objects' || segments.length !== 9) return false;
	const [
		_kind,
		targetRemoteId,
		targetEvidenceUpdatedAtMs,
		targetFailureKind,
		candidateRemoteId,
		proofId,
		proofVersion,
		proofEvaluatedAtMs,
		contentDigest
	] = segments;
	return (
		uuidPattern.test(targetRemoteId ?? '') &&
		isSafePositiveInteger(targetEvidenceUpdatedAtMs) &&
		(targetFailureKind === 'integrity' || targetFailureKind === 'missing') &&
		uuidPattern.test(candidateRemoteId ?? '') &&
		isSafePositiveInteger(proofId) &&
		isSafePositiveInteger(proofVersion) &&
		isSafePositiveInteger(proofEvaluatedAtMs) &&
		digestPattern.test(contentDigest ?? '')
	);
}

function isSafePositiveInteger(value: string | undefined): boolean {
	if (value === undefined || !positiveIntegerPattern.test(value)) return false;
	return Number.isSafeInteger(Number(value));
}
