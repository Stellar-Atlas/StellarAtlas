import { fetchPublicNetwork } from '../api/client';
import { GraphExplorer } from '../components/graph/graph-explorer';
import { AppShell } from '../components/layout/app-shell';

export const dynamic = 'force-dynamic';

export default async function Home(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();

	return (
		<AppShell network={network}>
			<GraphExplorer network={network} />
		</AppShell>
	);
}
