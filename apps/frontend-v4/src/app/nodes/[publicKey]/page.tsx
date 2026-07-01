import { notFound } from 'next/navigation';
import { fetchPublicNetwork } from '../../../api/client';
import { AppShell } from '../../../components/layout/app-shell';
import { PageHeading } from '../../../components/layout/page-heading';
import { NodeDetail } from '../../../components/nodes/node-detail';
import { getNodeLabel } from '../../../domain/network';

interface NodeDetailPageProps {
	params: Promise<{ publicKey: string }>;
}

export const dynamic = 'force-dynamic';

export default async function NodeDetailPage({
	params
}: NodeDetailPageProps): Promise<React.JSX.Element> {
	const { publicKey } = await params;
	const decodedPublicKey = decodeURIComponent(publicKey);
	const network = await fetchPublicNetwork();
	const node = network.nodes.find(
		(candidate) => candidate.publicKey === decodedPublicKey
	);

	if (!node) notFound();

	return (
		<AppShell network={network}>
			<main className="shell">
				<PageHeading
					description={node.homeDomain ?? node.host ?? node.publicKey}
					eyebrow="Node"
					title={getNodeLabel(node)}
				/>
				<NodeDetail network={network} node={node} />
			</main>
		</AppShell>
	);
}
