import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
	fetchHistoryArchiveBucketCoveragesForObjects,
	fetchHistoryArchiveObjectEvidenceForArchive
} from '@api/archive-scans-client';
import { fetchKnownNode } from '@api/known-network-client';
import {
	fetchKnownOrganizations,
	fetchHistoryArchiveScan,
	fetchHistoryArchiveScanEvidence,
	fetchHistoryArchiveScanLogs,
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
const maxBucketCoverageLookups = 8;

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
		historyArchiveObjectEvidence
	] = node?.historyUrl
		? await Promise.all([
				fetchHistoryArchiveScan(node.historyUrl, liveArchiveFetchOptions),
				fetchHistoryArchiveScanLogs(node.historyUrl, liveArchiveFetchOptions),
				fetchHistoryArchiveScanEvidence(
					node.historyUrl,
					500,
					liveArchiveFetchOptions
				),
				fetchHistoryArchiveObjectEvidenceForArchive(
					node.historyUrl,
					{ eventLimit: 250, objectLimit: 250 },
					liveArchiveFetchOptions
				)
			])
		: [null, [], null, null];
	const organization = node
		? getOrganizationForNode(inventoryNetwork, node)
		: null;
	const historyArchiveBucketCoverages = historyArchiveObjectEvidence
		? await fetchHistoryArchiveBucketCoveragesForObjects(
				historyArchiveObjectEvidence.objects,
				maxBucketCoverageLookups,
				liveArchiveFetchOptions
			)
		: [];

	return (
		<main className="shell">
			<PageHeading
				description={node?.homeDomain ?? node?.host ?? knownNode.publicKey}
				eyebrow="Node"
				title={node ? getNodeLabel(node) : knownNode.publicKey.slice(0, 12)}
			/>
			<NodeDetail
				historyArchiveEvidence={historyArchiveEvidence}
				historyArchiveEvents={
					historyArchiveObjectEvidence?.objectEvents ?? null
				}
				historyArchiveBucketCoverages={historyArchiveBucketCoverages}
				historyArchiveObjects={historyArchiveObjectEvidence?.objects ?? null}
				historyArchiveScan={historyArchiveScan}
				historyArchiveScanLogs={historyArchiveScanLogs}
				historyArchiveState={
					historyArchiveObjectEvidence?.scannerOwnedState ?? null
				}
				historyArchiveSummary={historyArchiveObjectEvidence?.summary ?? null}
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
