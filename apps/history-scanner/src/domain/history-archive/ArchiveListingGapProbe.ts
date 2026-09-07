import {
	probeGcsArchiveListingGap,
	type GcsArchiveListingGapInput,
	type GcsArchiveListingGapDependencies
} from './GcsArchiveListingGapProbe.js';
import {
	probeS3ArchiveListingGap,
	type S3ArchiveListingGapDependencies
} from './S3ArchiveListingGapProbe.js';
import {
	probeDirectoryArchiveListingGap,
	type DirectoryArchiveListingGapDependencies
} from './DirectoryArchiveListingGapProbe.js';
import { listingInputRoot } from './ArchiveListingProbeSupport.js';
import type { HistoryArchiveListingGapDTO } from 'history-scanner-dto';

export type ArchiveListingGapDependencies = Partial<
	GcsArchiveListingGapDependencies &
		S3ArchiveListingGapDependencies &
		DirectoryArchiveListingGapDependencies
>;

/** One optional, bounded provider-capability pass after an actual checkpoint-state 404. */
export async function probeArchiveListingGap(
	input: GcsArchiveListingGapInput,
	dependencies: ArchiveListingGapDependencies = {}
): Promise<HistoryArchiveListingGapDTO | null> {
	if (!listingInputRoot(input)) return null;
	let requests = 0;
	const fetcher = dependencies.fetch ?? fetch;
	const boundedFetch: typeof fetch = (url, options) => {
		if (++requests > 12)
			return Promise.reject(
				new Error('Archive listing request budget exhausted')
			);
		return fetcher(url, options);
	};
	const deps = { ...dependencies, fetch: boundedFetch };
	return (
		(await probeGcsArchiveListingGap(input, deps)) ??
		(await probeS3ArchiveListingGap(input, deps)) ??
		(await probeDirectoryArchiveListingGap(input, deps))
	);
}
