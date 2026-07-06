import { Suspense } from 'react';
import {
	fetchApiStatus,
	fetchArchiveScanWorkers,
	fetchDataQualityStatus,
	fetchFrontendStatus,
	fetchScanLogStatus,
	fetchWorkerStatus
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { StatusDashboard } from '@components/status/status-dashboard';

export const revalidate = 10;
export const dynamic = 'force-dynamic';

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const [
		api,
		dataQuality,
		scanLogs,
		workers,
		archiveWorkers,
		frontend
	] = await Promise.all([
		fetchApiStatus({ revalidate }),
		fetchDataQualityStatus({ revalidate }),
		fetchScanLogStatus({ revalidate }),
		fetchWorkerStatus({ revalidate }),
		fetchArchiveScanWorkers({ revalidate }),
		fetchFrontendStatus({ revalidate })
	]);

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, scan continuity, network rollups, archive queue, worker leases, and archive verification activity."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboard
				api={api}
				archiveWorkers={archiveWorkers}
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
