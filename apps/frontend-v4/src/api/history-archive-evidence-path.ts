import {
	buildArchiveEvidencePath,
	type KnownArchiveEvidenceQuery
} from './known-archive-evidence-query';

export function buildHistoryArchiveEvidencePath(
	historyUrl: string,
	query: KnownArchiveEvidenceQuery = {}
): string {
	return buildArchiveEvidencePath(
		`/v2/archive-scans/${encodeURIComponent(historyUrl)}/object-evidence`,
		query
	);
}
