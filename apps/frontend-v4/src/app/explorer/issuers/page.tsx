import { PageHeading } from '@components/layout/page-heading';
import { ExplorerIssuerDirectory } from '@components/blockchain/explorer-issuer-directory';
import Link from 'next/link';
import { ISSUER_DOMAIN_PATH } from '../../../api/issuer-domain';

export default function ExplorerIssuersPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				title="Issuers"
				eyebrow="Explorer"
				description="Browse indexed issuers or look up evidence for an exact DNS hostname."
			/>
			<p><Link href={ISSUER_DOMAIN_PATH}>Look up an issuer domain →</Link></p>
			<ExplorerIssuerDirectory />
		</main>
	);
}
