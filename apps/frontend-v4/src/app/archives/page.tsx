import { connection } from 'next/server';
import { fetchHistoryArchiveObjectStatusSummary } from '@api/archive-scans-client';
import { fetchPublicNodes, fetchPublicOrganizations } from '@api/client';
import { ArchiveRootInventory } from '@components/archive-scans/archive-root-inventory';
import { PageHeading } from '@components/layout/page-heading';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const liveFetchOptions = {
	cache: 'no-store',
	timeoutMs: 10_000
} as const;

export default async function ArchiveInventoryPage(): Promise<React.JSX.Element> {
	await connection();
	const [summary, nodes, organizations] = await Promise.all([
		fetchHistoryArchiveObjectStatusSummary(liveFetchOptions),
		fetchPublicNodes(liveFetchOptions),
		fetchPublicOrganizations(liveFetchOptions)
	]);
	const canonical = summary.canonicalProofProgress;

	return (
		<main className="shell archive-inventory-route">
			<PageHeading
				description="Every captured history archive root, the validators and listeners that currently advertise it, exact remote failures, proof coverage, outstanding work, and repair evidence."
				eyebrow="Archive verification"
				title="Archive root inventory"
				aside={
					<div className="heading-metrics">
						<strong>{summary.sourceCount.toLocaleString()}</strong>
						<span>captured roots</span>
						<strong>{canonical.verifiedCheckpoints.toLocaleString()}</strong>
						<span>unique checkpoints proven</span>
						<strong>{canonical.remainingCheckpoints.toLocaleString()}</strong>
						<span>unique checkpoints remaining</span>
					</div>
				}
			/>
			<section className="archive-inventory-explainer">
				<strong>How to read this table</strong>
				<p>
					A canonical checkpoint position is proven once. Each archive root then
					contributes source-specific evidence that it served matching bytes.
					Coverage is durable source attestations divided by the checkpoint
					positions implied by that root&apos;s newest ledger. Current
					proof-version and materialized-row counts are diagnostics, not the
					completion denominator. Remote archive failures belong to that root
					and its advertising nodes; scanner infrastructure issues are displayed
					separately and never reported as validator failures.
				</p>
			</section>
			<ArchiveRootInventory
				nodes={nodes}
				organizations={organizations}
				summary={summary}
			/>
		</main>
	);
}
