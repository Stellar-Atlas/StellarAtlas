import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchPublicNetwork, fetchScpAnimationBacklog } from '../api/client';
import { GraphExplorer } from '../components/graph/graph-explorer';
import { GraphLoadingPanel } from '../components/layout/route-fallbacks';

export const revalidate = 5;

async function GraphRouteContent(): Promise<React.JSX.Element> {
	await connection();
	const [network, scpBacklog] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchScpAnimationBacklog(4, { revalidate: 3 }).catch(() => null)
	]);
	const scpStatements =
		scpBacklog?.slots.flatMap((slot) => slot.statements) ?? [];

	return <GraphExplorer network={network} scpStatements={scpStatements} />;
}

export default function Home(): React.JSX.Element {
	return (
		<Suspense fallback={<GraphLoadingPanel />}>
			<GraphRouteContent />
		</Suspense>
	);
}
