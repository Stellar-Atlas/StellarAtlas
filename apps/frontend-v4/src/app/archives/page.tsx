import { Suspense } from 'react';
import { fetchArchiveInventorySnapshot } from '@api/archive-inventory-server';
import { ArchiveInventoryLive } from '@components/archive-scans/archive-inventory-live';
import { PageHeading } from '@components/layout/page-heading';

export const revalidate = 30;

export default function ArchiveInventoryPage(): React.JSX.Element {
	return (
		<main className="shell archive-inventory-route">
			<PageHeading
				description="Check archive coverage, find missing files, and inspect repairs by source or validator."
				eyebrow="Archive verification"
				title="Archives"
			/>
			<details className="archive-inventory-explainer">
				<summary>What is being verified?</summary>
				<p>
					Canonical checkpoint proofs verify shared content once. Source
					coverage records whether each archive served that content. A canonical
					replacement does not erase a missing-file finding against the original
					archive. File counts, checkpoint coverage, and analytics ingestion
					measure different work. These checks validate file hashes and
					cross-file commitments; they are not BLS proofs, consensus-signature
					verification, or transaction execution replay. Missing SCP files
					remain archive findings even though SCP is optional in the current
					checkpoint check.
				</p>
			</details>
			<Suspense
				fallback={
					<section className="panel detail-panel" role="status">
						Loading archive inventory…
					</section>
				}
			>
				<ArchiveInventoryContent />
			</Suspense>
		</main>
	);
}

async function ArchiveInventoryContent(): Promise<React.JSX.Element> {
	try {
		return (
			<ArchiveInventoryLive
				initialSnapshot={await fetchArchiveInventorySnapshot()}
			/>
		);
	} catch (error) {
		console.error('Archive inventory initial load failed', error);
		return <ArchiveInventoryLive initialSnapshot={null} />;
	}
}
