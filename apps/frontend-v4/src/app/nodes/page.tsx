import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchPublicNetwork } from '../../api/client';
import { NodeTable } from '../../components/nodes/node-table';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import {
	getActiveValidators,
	getListenerNodes,
	getRiskNodes
} from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const revalidate = 10;

async function NodesRouteContent(): Promise<React.JSX.Element> {
	await connection();
	const network = await fetchPublicNetwork({ revalidate });

	return (
		<main className="shell">
			<PageHeading
				description="Browse validators, listener nodes, reported software versions, geodata, availability, and current health signals."
				eyebrow={network.name}
				title="Nodes"
				aside={
					<div className="heading-metrics">
						<strong>
							{formatInteger(getActiveValidators(network.nodes).length)}
						</strong>
						<span>validators</span>
						<strong>
							{formatInteger(getListenerNodes(network.nodes).length)}
						</strong>
						<span>listeners</span>
						<strong>{formatInteger(getRiskNodes(network.nodes).length)}</strong>
						<span>warnings</span>
					</div>
				}
			/>
			<NodeTable network={network} nodes={network.nodes} />
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
