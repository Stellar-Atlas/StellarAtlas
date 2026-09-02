import { Suspense } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { fetchKnownOrganization } from '@api/known-network-client';
import { fetchPublicNetwork } from '@api/client';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { ArchiveEvidenceErrorBoundary } from '@components/archive-scans/archive-evidence-error-boundary';
import { ArchiveEvidenceRouteState } from '@components/archive-scans/archive-evidence-route-state';
import { OrganizationArchiveEvidenceRoute } from '@components/archive-scans/known-archive-evidence-route';
import { OrganizationDetail } from '@components/organizations/organization-detail';

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
	const organizationReference = decodeURIComponent(organizationId);
	const [network, knownOrganization] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownOrganization(organizationReference, { revalidate })
	]);
	if (!knownOrganization) notFound();
	const organization = knownOrganization.organization;
	if (organizationReference !== organization.id) {
		redirect(`/organizations/${encodeURIComponent(organization.id)}`);
	}
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
				<OrganizationArchiveEvidenceRoute organizationId={organization.id} />
			</Suspense>
		</ArchiveEvidenceErrorBoundary>
	);
	return (
		<main className="shell" data-inventory-scope={knownOrganization.scope}>
			<PageHeading
				description="Validator membership, availability, archive verification evidence, and published stellar.toml metadata."
				eyebrow={network.name}
				scopeContext={{
					kind: 'organization-record',
					scope: knownOrganization.scope
				}}
				title={organization.name ?? organization.dba ?? organization.homeDomain}
				aside={
					<Link className="button-link" href="/organizations">
						All organizations
					</Link>
				}
			/>
			<OrganizationDetail
				archiveEvidence={archiveEvidence}
				network={network}
				organization={organization}
			/>
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
