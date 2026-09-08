import { Suspense } from 'react';
import Link from 'next/link';
import '../../../components/nodes/node-detail.css';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { fetchKnownNode } from '@api/known-network-client';
import { fetchPublicNetwork } from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { ArchiveEvidenceErrorBoundary } from '@components/archive-scans/archive-evidence-error-boundary';
import { ArchiveEvidenceRouteState } from '@components/archive-scans/archive-evidence-route-state';
import { NodeArchiveEvidenceRoute } from '@components/archive-scans/known-archive-evidence-route';
import { NodeDetail } from '@components/nodes/node-detail';
import { getNodeLabel, getOrganizationForNode } from '@domain/network';
import { nodeRecordScopeLabels } from '@domain/known-network-scopes';

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
	const [network, knownNode] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNode(decodedPublicKey, { revalidate })
	]);
	const node = knownNode?.node ?? null;

	if (!knownNode) notFound();
	const organization = node ? getOrganizationForNode(network, node) : null;
	const archiveEvidence = (
		<ArchiveEvidenceErrorBoundary title="Archive health">
			<Suspense
				fallback={
					<ArchiveEvidenceRouteState state="loading" title="Archive health" />
				}
			>
				<NodeArchiveEvidenceRoute publicKey={decodedPublicKey} />
			</Suspense>
		</ArchiveEvidenceErrorBoundary>
	);

	return (
		<main
			className="shell node-detail-page"
			data-record-scope={knownNode.scope}
		>
			<PageHeading
				description="Node status, quorum relationships, and archive evidence."
				eyebrow={`${network.name} · ${nodeRecordScopeLabels[knownNode.scope]}`}
				title={node ? getNodeLabel(node) : knownNode.publicKey}
				aside={<Link href="/nodes">← All nodes</Link>}
			/>
			<NodeDetail
				archiveEvidence={archiveEvidence}
				knownNode={knownNode}
				network={network}
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
