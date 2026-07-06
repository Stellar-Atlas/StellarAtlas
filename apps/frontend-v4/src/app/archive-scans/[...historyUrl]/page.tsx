import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchHistoryArchiveObjectEvidenceForArchive } from '@api/archive-scans-client';
import {
	fetchHistoryArchiveScan,
	fetchHistoryArchiveScanEvidence,
	fetchHistoryArchiveScanLogs
} from '@api/client';
import { ArchiveScanDetail } from '@components/archive-scans/archive-scan-detail';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { decodeArchiveScanRouteParam } from '@domain/archive-scan-routes';

interface ArchiveScanDetailPageProps {
	params: Promise<{ historyUrl: string[] }>;
}

export const dynamicParams = true;
export const revalidate = 0;
const liveArchiveFetchOptions = { cache: 'no-store' } as const;

async function ArchiveScanDetailRouteContent({
	historyUrl
}: {
	readonly historyUrl: string;
}): Promise<React.JSX.Element> {
	await connection();
	const [scan, logs, evidence, objectEvidence] =
		await Promise.all([
			fetchHistoryArchiveScan(historyUrl, liveArchiveFetchOptions),
			fetchHistoryArchiveScanLogs(historyUrl, liveArchiveFetchOptions),
			fetchHistoryArchiveScanEvidence(historyUrl, 500, liveArchiveFetchOptions),
			fetchHistoryArchiveObjectEvidenceForArchive(
				historyUrl,
				{ eventLimit: 250, objectLimit: 250 },
				liveArchiveFetchOptions
			)
		]);

	return (
		<main className="shell">
			<PageHeading
				description={historyUrl}
				eyebrow="Archive scan"
				title={formatArchiveTitle(historyUrl)}
			/>
			<ArchiveScanDetail
				evidence={evidence}
				events={objectEvidence.objectEvents}
				historyUrl={historyUrl}
				logs={logs}
				objects={objectEvidence.objects}
				scan={scan}
				state={objectEvidence.scannerOwnedState}
				summary={objectEvidence.summary}
			/>
		</main>
	);
}

export default async function ArchiveScanDetailPage({
	params
}: ArchiveScanDetailPageProps): Promise<React.JSX.Element> {
	const { historyUrl } = await params;

	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<ArchiveScanDetailRouteContent
				historyUrl={decodeArchiveScanRouteParam(historyUrl)}
			/>
		</Suspense>
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
