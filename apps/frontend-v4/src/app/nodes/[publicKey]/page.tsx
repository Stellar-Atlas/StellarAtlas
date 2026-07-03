import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import {
	fetchHistoryArchiveScan,
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
	const network = await fetchPublicNetwork({ revalidate });
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === decodedPublicKey
	);

	if (!node) notFound();
	const [historyArchiveScan, historyArchiveScanLogs] = node.historyUrl
		? await Promise.all([
				fetchHistoryArchiveScan(node.historyUrl, { revalidate }),
				fetchHistoryArchiveScanLogs(node.historyUrl, { revalidate })
			])
		: [null, []];

	return (
		<main className="shell">
			<PageHeading
				description={node.homeDomain ?? node.host ?? node.publicKey}
				eyebrow="Node"
				title={getNodeLabel(node)}
			/>
			<NodeDetail
				historyArchiveScan={historyArchiveScan}
				historyArchiveScanLogs={historyArchiveScanLogs}
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
