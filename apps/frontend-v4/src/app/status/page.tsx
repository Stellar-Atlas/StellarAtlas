import { Suspense } from 'react';
import { fetchHistoryArchiveObjectEvents } from '@api/archive-scans-client';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFrontendStatus,
	fetchHistoryArchiveObjectSummary,
	fetchHistoryArchiveObjects,
	fetchScanLogStatus,
	fetchWorkerStatus
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { StatusDashboard } from '@components/status/status-dashboard';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
const statusFetchOptions = { cache: 'no-store' } as const;

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const [
		api,
		dataQuality,
		scanLogs,
		workers,
		archiveEvents,
		archiveSummary,
		archiveObjects,
		frontend
	] = await Promise.all([
		fetchApiStatus(statusFetchOptions),
		fetchDataQualityStatus(statusFetchOptions),
		fetchScanLogStatus(statusFetchOptions),
		fetchWorkerStatus(statusFetchOptions),
		fetchHistoryArchiveObjectEvents(100, statusFetchOptions),
		fetchHistoryArchiveObjectSummary(statusFetchOptions),
		fetchHistoryArchiveObjects(100, statusFetchOptions),
		fetchFrontendStatus(statusFetchOptions)
	]);

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, scan continuity, network rollups, archive object queue, scanner runtime, and archive verification activity."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboard
				api={api}
				archiveEvents={archiveEvents}
				archiveObjects={archiveObjects}
				archiveSummary={archiveSummary}
				dataQuality={dataQuality}
				frontend={frontend}
				scanLogs={scanLogs}
				workers={workers}
			/>
		</main>
	);
}

export default function StatusPage(): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<StatusRouteContent />
		</Suspense>
	);
}
