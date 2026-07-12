import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { fetchKnownNode } from '@api/known-network-client';
import { fetchKnownNodes, fetchPublicNetwork } from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteModal } from '@components/layout/route-modal';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { ArchiveEvidenceErrorBoundary } from '@components/archive-scans/archive-evidence-error-boundary';
import { ArchiveEvidenceRouteState } from '@components/archive-scans/archive-evidence-route-state';
import { NodeArchiveEvidenceRoute } from '@components/archive-scans/known-archive-evidence-route';
import { NodeDetail } from '@components/nodes/node-detail';
import { NodeTable } from '@components/nodes/node-table';
import { getNodeLabel, getOrganizationForNode } from '@domain/network';
import { formatInteger } from '@format/formatters';

interface NodeDetailPageProps {
	params: Promise<{ publicKey: string }>;
}

export const dynamicParams = true;
export const revalidate = 10;
async function NodeDetailRouteContent({
	publicKey
}: {
	publicKey: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedPublicKey = decodeURIComponent(publicKey);
	const [network, knownNode, knownNodes] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNode(decodedPublicKey, { revalidate }),
		fetchKnownNodes({ limit: 50, scope: 'all-known' }, { revalidate })
	]);
	const node = knownNode?.node ?? null;

	if (!knownNode) notFound();
	const snapshottedNodes = knownNodes.nodes.flatMap((candidate) =>
		candidate.node ? [candidate.node] : []
	);
	const inventoryNetwork = {
		...network,
		nodes: snapshottedNodes,
		organizations: network.organizations
	};
	const organization = node
		? getOrganizationForNode(inventoryNetwork, node)
		: null;
	const archiveEvidence = (
		<ArchiveEvidenceErrorBoundary title="Archive evidence">
			<Suspense
				fallback={
					<ArchiveEvidenceRouteState state="loading" title="Archive evidence" />
				}
			>
				<NodeArchiveEvidenceRoute publicKey={decodedPublicKey} />
			</Suspense>
		</ArchiveEvidenceErrorBoundary>
	);

	return (
		<main className="shell">
			<PageHeading
				description="Browse validators, listener nodes, reported software versions, geodata, availability, and current health signals."
				eyebrow={network.name}
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
				query=""
				scope="all-known"
				selectedPublicKey={knownNode.publicKey}
				totalCount={knownNodes.scopeTotals['all-known']}
			/>
			<RouteModal
				closeHref="/nodes"
				eyebrow="Node"
				title={node ? getNodeLabel(node) : knownNode.publicKey}
			>
				<NodeDetail
					archiveEvidence={archiveEvidence}
					knownNode={knownNode}
					network={inventoryNetwork}
					node={node}
					organization={organization}
				/>
			</RouteModal>
		</main>
	);
}

export default async function NodeDetailPage({
	params
}: NodeDetailPageProps): Promise<React.JSX.Element> {
	const { publicKey } = await params;

	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<NodeDetailRouteContent publicKey={publicKey} />
		</Suspense>
	);
}
