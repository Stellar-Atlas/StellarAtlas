import { Suspense } from 'react';
import { connection } from 'next/server';
import {
	fetchKnownNodes,
	fetchKnownOrganizations,
	fetchPublicNetwork
} from '../../api/client';
import { NodeTable } from '../../components/nodes/node-table';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import {
	getActiveValidators,
	getListenerNodes
} from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const revalidate = 10;

async function NodesRouteContent(): Promise<React.JSX.Element> {
	await connection();
	const [network, knownNodes, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNodes({ revalidate }),
		fetchKnownOrganizations({ revalidate })
	]);
	const snapshottedNodes = knownNodes.nodes.flatMap((knownNode) =>
		knownNode.node ? [knownNode.node] : []
	);
	const inventoryNetwork = {
		...network,
		nodes: snapshottedNodes,
		organizations: knownOrganizations.organizations.map(
			(knownOrganization) => knownOrganization.organization
		)
	};
	const publicKeyOnlyCount = knownNodes.nodes.length - snapshottedNodes.length;

	return (
		<main className="shell">
			<PageHeading
				description="Browse validators, listener nodes, reported software versions, geodata, availability, and current health signals."
				eyebrow={network.name}
				title="Nodes"
				aside={
					<div className="heading-metrics">
						<strong>
							{formatInteger(getActiveValidators(snapshottedNodes).length)}
						</strong>
						<span>validators</span>
						<strong>
							{formatInteger(getListenerNodes(snapshottedNodes).length)}
						</strong>
						<span>listeners</span>
						<strong>{formatInteger(publicKeyOnlyCount)}</strong>
						<span>public-key only</span>
					</div>
				}
			/>
			<NodeTable network={inventoryNetwork} nodes={knownNodes.nodes} />
		</main>
	);
}

export default function NodesPage(): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<NodesRouteContent />
		</Suspense>
	);
}
