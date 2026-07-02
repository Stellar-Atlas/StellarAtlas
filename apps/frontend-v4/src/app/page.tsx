import { Suspense } from 'react';
import { fetchPublicNetwork, fetchScpStatements } from '../api/client';
import { GraphExplorer } from '../components/graph/graph-explorer';
import { GraphLoadingPanel } from '../components/layout/route-fallbacks';

export const dynamic = 'force-dynamic';

async function GraphRouteContent(): Promise<React.JSX.Element> {
	const [network, scpStatements] = await Promise.all([
		fetchPublicNetwork(),
		fetchScpStatements({ limit: 120 }).catch(() => [])
	]);

	return <GraphExplorer network={network} scpStatements={scpStatements} />;
}

export default function Home(): React.JSX.Element {
	return (
		<Suspense fallback={<GraphLoadingPanel />}>
			<GraphRouteContent />
		</Suspense>
	);
}
