import { fetchPublicNetwork } from '../../api/client';
import { AppShell } from '../../components/layout/app-shell';
import { NetworkOverview } from '../../components/network-overview';

export const dynamic = 'force-dynamic';

export default async function OverviewPage(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();

	return (
		<AppShell network={network}>
			<NetworkOverview network={network} />
		</AppShell>
	);
}
