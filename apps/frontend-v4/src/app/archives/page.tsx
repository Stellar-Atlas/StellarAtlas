import { Suspense } from 'react';
import { fetchArchiveInventorySnapshot } from '@api/archive-inventory-server';
import { ArchiveInventoryLive } from '@components/archive-scans/archive-inventory-live';
import { PageHeading } from '@components/layout/page-heading';
import './archive-verification-explainer.css';

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
				<div className="archive-verification-explainer-grid">
					<section aria-labelledby="archive-explainer-canonical">
						<h2 id="archive-explainer-canonical">
							Canonical checkpoint checks
						</h2>
						<p>
							File hashes and cross-file commitments form shared checkpoint
							evidence. Matching content can reuse verified facts. These are not
							BLS proofs, SCP signature checks, or transaction execution replay.
						</p>
					</section>
					<section aria-labelledby="archive-explainer-source">
						<h2 id="archive-explainer-source">Each archive’s files</h2>
						<p>
							Source checks record the files and bytes each archive serves.
							Missing or mismatching files remain that source’s findings, even
							when a replacement lets scanning continue. Missing SCP files are
							still reported, although SCP is optional for checkpoint checks.
						</p>
					</section>
					<section aria-labelledby="archive-explainer-analytics">
						<h2 id="archive-explainer-analytics">Analytics ingestion</h2>
						<p>
							Decoding history into queryable datasets is separate work. Archive
							coverage does not mean the analytics dataset is fully ingested.
						</p>
					</section>
				</div>
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
