import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { fetchHistoryArchiveObjectEventsForArchive } from '@api/archive-scans-client';
import { fetchKnownNode } from '@api/known-network-client';
import {
	fetchKnownOrganizations,
	fetchHistoryArchiveScan,
	fetchHistoryArchiveScanEvidence,
	fetchHistoryArchiveScanLogs,
	fetchHistoryArchiveObjectSummaryForArchive,
	fetchHistoryArchiveObjectsForArchive,
	fetchHistoryArchiveState,
	fetchPublicNetwork
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { NodeDetail } from '@components/nodes/node-detail';
import { getNodeLabel, getOrganizationForNode } from '@domain/network';

interface NodeDetailPageProps {
	params: Promise<{ publicKey: string }>;
}

export const dynamicParams = true;
export const revalidate = 10;
const liveArchiveFetchOptions = { cache: 'no-store' } as const;

async function NodeDetailRouteContent({
	publicKey
}: {
	publicKey: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedPublicKey = decodeURIComponent(publicKey);
	const [network, knownNode, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNode(decodedPublicKey, { revalidate }),
		fetchKnownOrganizations({ revalidate })
	]);
	const node = knownNode?.node ?? null;

	if (!knownNode) notFound();
	const inventoryNetwork = {
		...network,
		nodes: node ? [node] : network.nodes,
		organizations: knownOrganizations.organizations.map(
			(candidate) => candidate.organization
		)
	};
	const [
		historyArchiveScan,
		historyArchiveScanLogs,
		historyArchiveEvidence,
		historyArchiveSummary,
		historyArchiveObjects,
		historyArchiveEvents,
		historyArchiveState
	] = node?.historyUrl
		? await Promise.all([
				fetchHistoryArchiveScan(node.historyUrl, liveArchiveFetchOptions),
				fetchHistoryArchiveScanLogs(node.historyUrl, liveArchiveFetchOptions),
				fetchHistoryArchiveScanEvidence(
					node.historyUrl,
					500,
					liveArchiveFetchOptions
				),
				fetchHistoryArchiveObjectSummaryForArchive(
					node.historyUrl,
					liveArchiveFetchOptions
				),
				fetchHistoryArchiveObjectsForArchive(
					node.historyUrl,
					250,
					liveArchiveFetchOptions
				),
				fetchHistoryArchiveObjectEventsForArchive(
					node.historyUrl,
					250,
					liveArchiveFetchOptions
				),
				fetchHistoryArchiveState(node.historyUrl, liveArchiveFetchOptions)
			])
		: [null, [], null, null, null, null, null];
	const organization = node
		? getOrganizationForNode(inventoryNetwork, node)
		: null;

	return (
		<main className="shell">
			<PageHeading
				description={node?.homeDomain ?? node?.host ?? knownNode.publicKey}
				eyebrow="Node"
				title={node ? getNodeLabel(node) : knownNode.publicKey.slice(0, 12)}
			/>
			<NodeDetail
				historyArchiveEvidence={historyArchiveEvidence}
				historyArchiveEvents={historyArchiveEvents}
				historyArchiveObjects={historyArchiveObjects}
				historyArchiveScan={historyArchiveScan}
				historyArchiveScanLogs={historyArchiveScanLogs}
				historyArchiveState={historyArchiveState}
				historyArchiveSummary={historyArchiveSummary}
				knownNode={knownNode}
				network={inventoryNetwork}
				node={node}
				organization={organization}
			/>
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
