import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { connection } from 'next/server';
import { fetchHistoryArchiveObjectEventsForArchive } from '@api/archive-scans-client';
import {
	fetchHistoryArchiveObjectsForArchive,
	fetchHistoryArchiveObjectSummaryForArchive,
	fetchHistoryArchiveState,
	fetchKnownNodes,
	fetchKnownOrganizations,
	fetchPublicNetwork
} from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { OrganizationDetail } from '@components/organizations/organization-detail';
import { OrganizationTable } from '@components/organizations/organization-table';
import { getTopOrganizations } from '@domain/network';
import { formatInteger } from '@format/formatters';

interface OrganizationDetailPageProps {
	params: Promise<{ organizationId: string }>;
}

export const dynamicParams = true;
export const revalidate = 10;
const liveArchiveFetchOptions = { cache: 'no-store' } as const;

async function OrganizationDetailRouteContent({
	organizationId
}: {
	organizationId: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedOrganizationId = decodeURIComponent(organizationId);
	const [network, knownNodes, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownNodes({ revalidate }),
		fetchKnownOrganizations({ revalidate })
	]);
	const knownOrganization = knownOrganizations.organizations.find(
		(candidate) => candidate.organization.id === decodedOrganizationId
	);
	const organization = knownOrganization?.organization;

	if (!organization) notFound();
	const inventoryNetwork = {
		...network,
		nodes: knownNodes.nodes.flatMap((candidate) =>
			candidate.node ? [candidate.node] : []
		),
		organizations: knownOrganizations.organizations.map(
			(candidate) => candidate.organization
		)
	};
	const organizations = knownOrganizations.organizations.map(
		(candidate) => candidate.organization
	);
	const organizationNodes = inventoryNetwork.nodes.filter(
		(node) => node.organizationId === organization.id
	);
	const validatorHistoryUrls = Array.from(
		new Set(
			organizationNodes.flatMap((node) =>
				node.historyUrl === null ? [] : [node.historyUrl]
			)
		)
	);
	const archiveStates = await Promise.all(
		validatorHistoryUrls.map(async (historyUrl) => ({
			historyUrl,
			objects: await fetchHistoryArchiveObjectsForArchive(
				historyUrl,
				1,
				liveArchiveFetchOptions
			),
			events: await fetchHistoryArchiveObjectEventsForArchive(
				historyUrl,
				5,
				liveArchiveFetchOptions
			),
			summary: await fetchHistoryArchiveObjectSummaryForArchive(
				historyUrl,
				liveArchiveFetchOptions
			),
			state: await fetchHistoryArchiveState(historyUrl, liveArchiveFetchOptions)
		}))
	);

	return (
		<main className="shell">
			<PageHeading
				description="Explore organizations, validator sets, TOML state, Horizon URLs, and subquorum availability."
				eyebrow={network.name}
				title="Organizations"
				aside={
					<div className="heading-metrics">
						<strong>{formatInteger(knownOrganizations.count)}</strong>
						<span>discovered</span>
						<strong>
							{formatInteger(
								getTopOrganizations(organizations).at(0)?.validators.length ?? 0
							)}
						</strong>
						<span>largest validator set</span>
					</div>
				}
			/>
			<OrganizationTable
				organizations={knownOrganizations.organizations}
				selectedOrganizationId={organization.id}
			/>
			<div className="route-modal-layer" role="presentation">
				<Link
					aria-label="Close organization details"
					className="route-modal-backdrop"
					href="/organizations"
				/>
				<section
					aria-label={`${organization.homeDomain} organization details`}
					className="route-modal"
				>
					<div className="route-modal-header">
						<div>
							<p className="eyebrow">Organization</p>
							<h2>
								{organization.name ??
									organization.dba ??
									organization.homeDomain}
							</h2>
						</div>
						<Link className="close-route-modal" href="/organizations">
							Close
						</Link>
					</div>
					<OrganizationDetail
						archiveStates={archiveStates}
						network={inventoryNetwork}
						organization={organization}
						organizationNodes={organizationNodes}
					/>
				</section>
			</div>
		</main>
	);
}

export default async function OrganizationDetailPage({
	params
}: OrganizationDetailPageProps): Promise<React.JSX.Element> {
	const { organizationId } = await params;

	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<OrganizationDetailRouteContent organizationId={organizationId} />
		</Suspense>
	);
}
