import { fetchPublicNetwork } from '../../api/client';
import { NodeTable } from '../../components/nodes/node-table';
import { AppShell } from '../../components/layout/app-shell';
import { PageHeading } from '../../components/layout/page-heading';
import { getActiveValidators, getListenerNodes, getRiskNodes } from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const dynamic = 'force-dynamic';

export default async function NodesPage(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();

	return (
		<AppShell network={network}>
			<main className="shell">
				<PageHeading
					description="Browse validators, listener nodes, reported software versions, geodata, availability, and current health signals."
					eyebrow={network.name}
					title="Nodes"
					aside={
						<div className="heading-metrics">
							<strong>{formatInteger(getActiveValidators(network.nodes).length)}</strong>
							<span>validators</span>
							<strong>{formatInteger(getListenerNodes(network.nodes).length)}</strong>
							<span>listeners</span>
							<strong>{formatInteger(getRiskNodes(network.nodes).length)}</strong>
							<span>warnings</span>
						</div>
					}
				/>
				<NodeTable network={network} nodes={network.nodes} />
			</main>
		</AppShell>
	);
}
