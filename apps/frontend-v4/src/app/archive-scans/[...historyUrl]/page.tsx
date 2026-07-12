import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchHistoryArchiveObjectEvidenceForArchive } from '@api/archive-scans-client';
import { ArchiveEvidenceErrorBoundary } from '@components/archive-scans/archive-evidence-error-boundary';
import { ArchiveEvidenceRouteState } from '@components/archive-scans/archive-evidence-route-state';
import { KnownArchiveEvidence } from '@components/archive-scans/known-archive-evidence';
import { PageHeading } from '@components/layout/page-heading';
import { decodeArchiveScanRouteParam } from '@domain/archive-scan-routes';
import {
	archiveEvidenceCopyLimit,
	archiveEvidencePageLimit,
	toKnownArchiveEvidence
} from '@domain/known-archive-evidence';

interface ArchiveScanDetailPageProps {
	params: Promise<{ historyUrl: string[] }>;
}

export const dynamicParams = true;
export const revalidate = 0;
const liveArchiveFetchOptions = { cache: 'no-store' } as const;

async function ArchiveSourceEvidenceRoute({
	historyUrl
}: {
	readonly historyUrl: string;
}): Promise<React.JSX.Element> {
	await connection();
	const archiveEvidence = await fetchHistoryArchiveObjectEvidenceForArchive(
		historyUrl,
		{
			copyLimit: archiveEvidenceCopyLimit,
			eventLimit: archiveEvidencePageLimit,
			failureLimit: archiveEvidencePageLimit,
			objectLimit: archiveEvidencePageLimit,
			objectStatus: 'pending',
			workerIssueLimit: archiveEvidencePageLimit
		},
		liveArchiveFetchOptions
	);

	return (
		<KnownArchiveEvidence
			evidence={toKnownArchiveEvidence(archiveEvidence)}
			subject={{ id: historyUrl, kind: 'archive' }}
			title="Archive evidence"
		/>
	);
}

export default async function ArchiveScanDetailPage({
	params
}: ArchiveScanDetailPageProps): Promise<React.JSX.Element> {
	const { historyUrl } = await params;
	const decodedHistoryUrl = decodeArchiveScanRouteParam(historyUrl);

	return (
		<main className="shell">
			<PageHeading
				description={decodedHistoryUrl}
				eyebrow="Archive source"
				title={formatArchiveTitle(decodedHistoryUrl)}
			/>
			<ArchiveEvidenceErrorBoundary title="Archive evidence">
				<Suspense
					fallback={
						<ArchiveEvidenceRouteState
							state="loading"
							title="Archive evidence"
						/>
					}
				>
					<ArchiveSourceEvidenceRoute historyUrl={decodedHistoryUrl} />
				</Suspense>
			</ArchiveEvidenceErrorBoundary>
		</main>
	);
}

function formatArchiveTitle(historyUrl: string): string {
	try {
		const url = new URL(historyUrl);
		const path = url.pathname.replace(/\/+$/, '');
		return path.length > 0 ? `${url.hostname}${path}` : url.hostname;
	} catch {
		return 'Archive scan detail';
	}
}
