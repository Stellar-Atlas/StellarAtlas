import { Suspense } from 'react';
import { fetchArchiveInventorySnapshot } from '@api/archive-inventory-server';
import { ArchiveInventoryLive } from '@components/archive-scans/archive-inventory-live';
import { PageHeading } from '@components/layout/page-heading';

export const revalidate = 30;

export default function ArchiveInventoryPage(): React.JSX.Element {
	return (
		<main className="shell archive-inventory-route">
			<PageHeading
				description="Every captured history archive root, its advertising nodes, source-specific failures, checkpoint coverage, and repair evidence."
				eyebrow="Archive verification"
				title="Archive root inventory"
			/>
			<section className="archive-inventory-explainer">
				<strong>How to read this table</strong>
				<p>
					Canonical checkpoint proofs verify shared content once. Source
					coverage records whether each archive served that content. A canonical
					replacement does not erase a missing-file finding against the original
					archive. File counts, checkpoint coverage, and analytics ingestion
					measure different work.
				</p>
			</section>
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
