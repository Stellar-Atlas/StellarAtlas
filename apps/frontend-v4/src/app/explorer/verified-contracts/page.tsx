import { Suspense } from 'react';
import {
	loadContractCatalogue,
	parseCatalogueQuery,
	verifiedContractsHref,
	type CatalogueQuery,
	type CatalogueSearchParams
} from '@api/verified-contract-catalogue';
import { ExplorerEntityNavigation } from '@components/blockchain/explorer-entity-navigation';
import {
	VerifiedContractFilters,
	VerifiedContractResults,
	VerificationGuideLink
} from '@components/blockchain/explorer-verified-contracts';
import styles from '@components/blockchain/explorer-entity.module.css';
import { PageHeading } from '@components/layout/page-heading';

async function CatalogueResults({ query }: { readonly query: CatalogueQuery }): Promise<React.JSX.Element> {
	return <VerifiedContractResults query={query} result={await loadContractCatalogue(query)} />;
}

export default async function VerifiedContractsPage({ searchParams }: {
	readonly searchParams: Promise<CatalogueSearchParams>;
}): Promise<React.JSX.Element> {
	const query = parseCatalogueQuery(await searchParams);
	return (
		<main className="shell">
			<PageHeading eyebrow="Explorer" title="Verified contracts"
				description="Browse recorded build attestations for Stellar contracts."
				aside={<VerificationGuideLink />} />
			<div className={styles.workspace}>
				<ExplorerEntityNavigation active="verified-contracts" />
				<VerifiedContractFilters query={query} />
				{query && (
					<Suspense key={verifiedContractsHref(query)} fallback={
						<section className={styles.panel} aria-label="Catalogue results" aria-busy="true">
							<p role="status">Loading verified contracts…</p>
						</section>
					}>
						<CatalogueResults query={query} />
					</Suspense>
				)}
			</div>
		</main>
	);
}
