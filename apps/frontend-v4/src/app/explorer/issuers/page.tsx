import { PageHeading } from '@components/layout/page-heading';
import { ExplorerIssuerDirectory } from '@components/blockchain/explorer-issuer-directory';

export default function ExplorerIssuersPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				title="Issuers"
				eyebrow="Explorer"
				description="Find issuers by address or published home domain."
			/>
			<ExplorerIssuerDirectory />
		</main>
	);
}
