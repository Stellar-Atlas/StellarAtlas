import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { fetchKnownOrganization } from '@api/known-network-client';
import { fetchKnownOrganizations, fetchPublicNetwork } from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteModal } from '@components/layout/route-modal';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { ArchiveEvidenceErrorBoundary } from '@components/archive-scans/archive-evidence-error-boundary';
import { ArchiveEvidenceRouteState } from '@components/archive-scans/archive-evidence-route-state';
import { OrganizationArchiveEvidenceRoute } from '@components/archive-scans/known-archive-evidence-route';
import { OrganizationDetail } from '@components/organizations/organization-detail';
import { OrganizationTable } from '@components/organizations/organization-table';
import { getTopOrganizations } from '@domain/network';
import { formatInteger } from '@format/formatters';

interface OrganizationDetailPageProps {
	params: Promise<{ organizationId: string }>;
}

export const dynamicParams = true;
export const revalidate = 10;
async function OrganizationDetailRouteContent({
	organizationId
}: {
	organizationId: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedOrganizationId = decodeURIComponent(organizationId);
	const [network, knownOrganizations, knownOrganization] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownOrganizations({ limit: 25, scope: 'all-known' }, { revalidate }),
		fetchKnownOrganization(decodedOrganizationId, { revalidate })
	]);
	if (!knownOrganization) notFound();
	const organization = knownOrganization.organization;
	const organizations = knownOrganizations.organizations.map(
		(candidate) => candidate.organization
	);
	const archiveEvidence = (
		<ArchiveEvidenceErrorBoundary title="Organization archive health">
			<Suspense
				fallback={
					<ArchiveEvidenceRouteState
						state="loading"
						title="Organization archive health"
					/>
				}
			>
				<OrganizationArchiveEvidenceRoute
					organizationId={decodedOrganizationId}
				/>
			</Suspense>
		</ArchiveEvidenceErrorBoundary>
	);
	return (
		<main className="shell" data-inventory-scope={knownOrganizations.scope}>
			<PageHeading
				description="Explore organizations, validator sets, stored stellar.toml state, public ledger API URLs, and quorum-path availability."
				eyebrow={network.name}
				scopeContext={{
					kind: 'organization-inventory',
					scope: knownOrganizations.scope
				}}
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
				page={knownOrganizations.page}
				query=""
				scope="all-known"
				selectedOrganizationId={organization.id}
				totalCount={knownOrganizations.scopeTotals['all-known']}
			/>
			<RouteModal
				closeHref="/organizations"
				eyebrow="Organization"
				scopeContext={{
					kind: 'organization-record',
					scope: knownOrganization.scope
				}}
				title={organization.name ?? organization.dba ?? organization.homeDomain}
			>
				<OrganizationDetail
					archiveEvidence={archiveEvidence}
					network={network}
					organization={organization}
				/>
			</RouteModal>
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
