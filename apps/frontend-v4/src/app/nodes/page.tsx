import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchKnownNodes, fetchPublicNetwork } from '../../api/client';
import { fetchNetworkSearch } from '../../api/network-search-client';
import type { PublicSearchArchiveStatusFilter } from '../../api/search-types';
import { NodeTable } from '../../components/nodes/node-table';
import { NodeArchiveStatusTable } from '../../components/nodes/node-archive-status-table';
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
	const archiveStatus = parseArchiveStatus(params.archiveStatus);
	const limit = archiveStatus ? 25 : 50;
	const [network, knownNodes, archiveSearch] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNodes(
			archiveStatus
				? { limit: 1, scope: 'current-validator' }
				: { limit, offset: (page - 1) * limit, query, scope },
			{ revalidate }
		),
		archiveStatus
			? fetchNetworkSearch(
					query,
					{
						archiveStatus,
						entityType: 'node',
						offset: (page - 1) * limit,
						scope: 'current-validator',
						validator: true
					},
					limit,
					{ revalidate }
				)
			: Promise.resolve(null)
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
		<main
			className="shell"
			data-archive-status={archiveStatus}
			data-inventory-scope={
				archiveStatus ? 'current-validator' : knownNodes.scope
			}
		>
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
			{archiveStatus && archiveSearch ? (
				<NodeArchiveStatusTable
					archiveStatus={archiveStatus}
					query={query}
					response={archiveSearch}
				/>
			) : (
				<NodeTable
					archiveStatus={archiveStatus}
					network={inventoryNetwork}
					nodes={knownNodes.nodes}
					page={knownNodes.page}
					query={query}
					scope={scope}
					totalCount={knownNodes.scopeTotals['all-known']}
				/>
			)}
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

function parseArchiveStatus(
	value: string | string[] | undefined
): PublicSearchArchiveStatusFilter | undefined {
	const status = singleValue(value);
	return status === 'error' ||
		status === 'issue' ||
		status === 'ok' ||
		status === 'scanner-issue' ||
		status === 'unknown' ||
		status === 'unreachable'
		? status
		: undefined;
}
