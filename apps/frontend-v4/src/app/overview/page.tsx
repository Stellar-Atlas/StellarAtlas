import { Suspense } from 'react';
import { fetchPublicNetwork } from '../../api/client';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import { NetworkOverview } from '../../components/network-overview';

export const dynamic = 'force-dynamic';

async function OverviewRouteContent(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();

	return <NetworkOverview network={network} />;
}

export default function OverviewPage(): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<OverviewRouteContent />
		</Suspense>
	);
}
