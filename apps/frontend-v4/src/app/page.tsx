import { fetchPublicNetwork, fetchScpStatements } from '../api/client';
import { GraphExplorer } from '../components/graph/graph-explorer';
import { AppShell } from '../components/layout/app-shell';

export const dynamic = 'force-dynamic';

export default async function Home(): Promise<React.JSX.Element> {
	const [network, scpStatements] = await Promise.all([
		fetchPublicNetwork(),
		fetchScpStatements({ limit: 120 }).catch(() => [])
	]);

	return (
		<AppShell network={network}>
			<GraphExplorer network={network} scpStatements={scpStatements} />
		</AppShell>
	);
}
