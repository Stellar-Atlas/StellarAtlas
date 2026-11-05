import { Suspense } from 'react';
import { PageHeading } from '@components/layout/page-heading';
import { ExplorerEntityNavigation } from '@components/blockchain/explorer-entity-navigation';
import { ExplorerIssuerDomain } from '@components/blockchain/explorer-issuer-domain';

export default function IssuerDomainPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading title="Issuer domain" eyebrow="Explorer" />
			<ExplorerEntityNavigation active="issuers" />
			<Suspense fallback={<p role="status">Loading issuer lookup…</p>}>
				<ExplorerIssuerDomain />
			</Suspense>
		</main>
	);
}
