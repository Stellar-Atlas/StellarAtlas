import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
	fetchHistoryArchiveBucketCoveragesForObjects,
	fetchHistoryArchiveObjectEvidenceForArchive,
	fetchHistoryArchiveRepairPlanForArchive
} from '@api/archive-scans-client';
import { fetchKnownNode } from '@api/known-network-client';
import {
	fetchKnownNodes,
	fetchKnownOrganizations,
	fetchPublicNetwork
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { NodeDetail } from '@components/nodes/node-detail';
import { NodeTable } from '@components/nodes/node-table';
import {
	getActiveValidators,
	getListenerNodes,
	getNodeLabel,
	getOrganizationForNode
} from '@domain/network';
import { formatInteger } from '@format/formatters';

interface NodeDetailPageProps {
	params: Promise<{ publicKey: string }>;
}

export const dynamicParams = true;
export const revalidate = 10;
const liveArchiveFetchOptions = {
	cache: 'no-store',
	timeoutMs: 12000
} as const;
const maxBucketCoverageLookups = 8;

async function NodeDetailRouteContent({
	publicKey
}: {
	publicKey: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedPublicKey = decodeURIComponent(publicKey);
	const [network, knownNode, knownNodes, knownOrganizations] =
		await Promise.all([
			fetchPublicNetwork({ revalidate }),
			fetchKnownNode(decodedPublicKey, { revalidate }),
			fetchKnownNodes({ revalidate }),
			fetchKnownOrganizations({ revalidate })
		]);
	const node = knownNode?.node ?? null;

	if (!knownNode) notFound();
	const snapshottedNodes = knownNodes.nodes.flatMap((candidate) =>
		candidate.node ? [candidate.node] : []
	);
	const inventoryNetwork = {
		...network,
		nodes: snapshottedNodes,
		organizations: knownOrganizations.organizations.map(
			(candidate) => candidate.organization
		)
	};
	const publicKeyOnlyCount = knownNodes.nodes.length - snapshottedNodes.length;
	const [historyArchiveObjectEvidence, historyArchiveRepairPlan] = node?.historyUrl
		? await Promise.all([
				fetchHistoryArchiveObjectEvidenceForArchive(
					node.historyUrl,
					{ eventLimit: 250, objectLimit: 250 },
					liveArchiveFetchOptions
				).catch(() => null),
				fetchHistoryArchiveRepairPlanForArchive(
					node.historyUrl,
					100,
					liveArchiveFetchOptions
				).catch(() => null)
			])
		: [null, null];
	const organization = node
		? getOrganizationForNode(inventoryNetwork, node)
		: null;
	const historyArchiveBucketCoverages = historyArchiveObjectEvidence
		? await fetchHistoryArchiveBucketCoveragesForObjects(
				historyArchiveObjectEvidence.objects,
				maxBucketCoverageLookups,
				liveArchiveFetchOptions
			).catch(() => [])
		: [];

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
			<NodeTable
				network={inventoryNetwork}
				nodes={knownNodes.nodes}
				selectedPublicKey={knownNode.publicKey}
			/>
			<div className="route-modal-layer" role="presentation">
				<Link
					aria-label="Close node details"
					className="route-modal-backdrop"
					href="/nodes"
				/>
				<section
					aria-label={`${node ? getNodeLabel(node) : knownNode.publicKey} node details`}
					className="route-modal"
				>
					<div className="route-modal-header">
						<div>
							<p className="eyebrow">Node</p>
							<h2>{node ? getNodeLabel(node) : knownNode.publicKey}</h2>
						</div>
						<Link className="close-route-modal" href="/nodes">
							Close
						</Link>
					</div>
					<NodeDetail
						historyArchiveEvents={
							historyArchiveObjectEvidence?.objectEvents ?? null
						}
						historyArchiveBucketCoverages={historyArchiveBucketCoverages}
						historyArchiveObjects={historyArchiveObjectEvidence?.objects ?? null}
						historyArchiveRepairPlan={historyArchiveRepairPlan}
						historyArchiveState={
							historyArchiveObjectEvidence?.scannerOwnedState ?? null
						}
						historyArchiveSummary={historyArchiveObjectEvidence?.summary ?? null}
						knownNode={knownNode}
						network={inventoryNetwork}
						node={node}
						organization={organization}
					/>
				</section>
			</div>
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
