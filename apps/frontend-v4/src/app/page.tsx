import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchPublicNetwork, fetchScpStatements } from '../api/client';
import { GraphExplorer } from '../components/graph/graph-explorer';
import { GraphLoadingPanel } from '../components/layout/route-fallbacks';

export const revalidate = 5;

async function GraphRouteContent(): Promise<React.JSX.Element> {
	await connection();
	const [network, scpStatements] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchScpStatements({ limit: 160, revalidate: 3 }).catch(() => [])
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
