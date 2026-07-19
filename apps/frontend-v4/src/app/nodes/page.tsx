import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchKnownNodes, fetchPublicNetwork } from '../../api/client';
import { NodeTable } from '../../components/nodes/node-table';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import { formatInteger } from '../../format/formatters';

export const revalidate = 10;

interface NodesRouteProps {
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function NodesRouteContent({
	searchParams
}: NodesRouteProps): Promise<React.JSX.Element> {
	await connection();
	const params = await searchParams;
	const scope = parseNodeScope(params.scope);
	const page = parsePage(params.page);
	const query = singleValue(params.q)?.slice(0, 128) ?? '';
	const limit = 50;
	const [network, knownNodes] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNodes(
			{ limit, offset: (page - 1) * limit, query, scope },
			{ revalidate }
		)
	]);
	const snapshottedNodes = knownNodes.nodes.flatMap((knownNode) =>
		knownNode.node ? [knownNode.node] : []
	);
	const inventoryNetwork = {
		...network,
		nodes: snapshottedNodes,
		organizations: network.organizations
	};
	return (
		<main className="shell" data-inventory-scope={knownNodes.scope}>
			<PageHeading
				description="Browse validators, listener nodes, reported software versions, geodata, availability, and current health signals."
				eyebrow={network.name}
				scopeContext={{ kind: 'node-inventory', scope: knownNodes.scope }}
				title="Nodes"
				aside={
					<div className="heading-metrics">
						<strong>
							{formatInteger(knownNodes.scopeTotals['current-validator'])}
						</strong>
						<span>current validators</span>
						<strong>{formatInteger(knownNodes.scopeTotals.listener)}</strong>
						<span>current listeners</span>
						<strong>
							{formatInteger(knownNodes.scopeTotals['public-key-only'])}
						</strong>
						<span>public-key only</span>
					</div>
				}
			/>
			<NodeTable
				network={inventoryNetwork}
				nodes={knownNodes.nodes}
				page={knownNodes.page}
				query={query}
				scope={scope}
				totalCount={knownNodes.scopeTotals['all-known']}
			/>
		</main>
	);
}

export default function NodesPage(props: NodesRouteProps): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<NodesRouteContent {...props} />
		</Suspense>
	);
}

function singleValue(value: string | string[] | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parsePage(value: string | string[] | undefined): number {
	const parsed = Number(singleValue(value));
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parseNodeScope(value: string | string[] | undefined) {
	const scope = singleValue(value);
	return scope === 'listener' ||
		scope === 'public-key-only' ||
		scope === 'archived' ||
		scope === 'all-known'
		? scope
		: 'current-validator';
}
