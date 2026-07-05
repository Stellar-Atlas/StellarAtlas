import { Suspense } from 'react';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFailoverStatus,
	fetchFrontendStatus,
	fetchHorizonStatus,
	fetchRpcStatus,
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
		frontend,
		horizon,
		rpc,
		failover
	] = await Promise.all([
		fetchApiStatus({ revalidate }),
		fetchDataQualityStatus({ revalidate }),
		fetchScanLogStatus({ revalidate }),
		fetchWorkerStatus({ revalidate }),
		fetchFrontendStatus({ revalidate }),
		fetchHorizonStatus({ revalidate }),
		fetchRpcStatus({ revalidate }),
		fetchFailoverStatus({ revalidate })
	]);

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, scan continuity, rollup proof, archive queue, worker, and configured service target status."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboard
				api={api}
				dataQuality={dataQuality}
				failover={failover}
				frontend={frontend}
				horizon={horizon}
				rpc={rpc}
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
