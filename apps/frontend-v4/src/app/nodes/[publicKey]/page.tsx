import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import {
	fetchHistoryArchiveScan,
	fetchPublicNetwork
} from '../../../api/client';
import { PageHeading } from '../../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../../components/layout/route-fallbacks';
import { NodeDetail } from '../../../components/nodes/node-detail';
import { getNodeLabel } from '../../../domain/network';

interface NodeDetailPageProps {
	params: Promise<{ publicKey: string }>;
}

export const dynamic = 'force-dynamic';

async function NodeDetailRouteContent({
	publicKey
}: {
	publicKey: string;
}): Promise<React.JSX.Element> {
	const decodedPublicKey = decodeURIComponent(publicKey);
	const network = await fetchPublicNetwork();
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === decodedPublicKey
	);

	if (!node) notFound();
	const historyArchiveScan = node.historyUrl
		? await fetchHistoryArchiveScan(node.historyUrl)
		: null;

	return (
		<main className="shell">
			<PageHeading
				description={node.homeDomain ?? node.host ?? node.publicKey}
				eyebrow="Node"
				title={getNodeLabel(node)}
			/>
			<NodeDetail
				historyArchiveScan={historyArchiveScan}
				network={network}
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
