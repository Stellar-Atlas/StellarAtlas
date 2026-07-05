import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
	fetchKnownNodes,
	fetchKnownOrganizations,
	fetchHistoryArchiveScan,
	fetchHistoryArchiveScanEvidence,
	fetchHistoryArchiveScanLogs,
	fetchPublicNetwork
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { NodeDetail } from '@components/nodes/node-detail';
import { getNodeLabel } from '@domain/network';

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
	const [network, knownNodes, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNodes({ revalidate }),
		fetchKnownOrganizations({ revalidate })
	]);
	const knownNode = knownNodes.nodes.find(
		(candidate) => candidate.publicKey === decodedPublicKey
	);
	const node = knownNode?.node ?? null;

	if (!knownNode) notFound();
	const inventoryNetwork = {
		...network,
		nodes: knownNodes.nodes.flatMap((candidate) =>
			candidate.node ? [candidate.node] : []
		),
		organizations: knownOrganizations.organizations.map(
			(candidate) => candidate.organization
		)
	};
	const [historyArchiveScan, historyArchiveScanLogs, historyArchiveEvidence] =
		node?.historyUrl
			? await Promise.all([
					fetchHistoryArchiveScan(node.historyUrl, { revalidate }),
					fetchHistoryArchiveScanLogs(node.historyUrl, { revalidate }),
					fetchHistoryArchiveScanEvidence(node.historyUrl, 500, {
						revalidate
					})
				])
			: [null, [], null];

	return (
		<main className="shell">
			<PageHeading
				description={node?.homeDomain ?? node?.host ?? knownNode.publicKey}
				eyebrow="Node"
				title={node ? getNodeLabel(node) : knownNode.publicKey.slice(0, 12)}
			/>
			<NodeDetail
				historyArchiveEvidence={historyArchiveEvidence}
				historyArchiveScan={historyArchiveScan}
				historyArchiveScanLogs={historyArchiveScanLogs}
				knownNode={knownNode}
				network={inventoryNetwork}
				node={node}
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
