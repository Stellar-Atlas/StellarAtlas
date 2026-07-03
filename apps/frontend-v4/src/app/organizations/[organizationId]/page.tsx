import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { connection } from 'next/server';
import { fetchPublicNetwork } from '@api/client';
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

async function OrganizationDetailRouteContent({
	organizationId
}: {
	organizationId: string;
}): Promise<React.JSX.Element> {
	await connection();
	const decodedOrganizationId = decodeURIComponent(organizationId);
	const network = await fetchPublicNetwork({ revalidate });
	const organization = network.organizations.find(
		(candidate) => candidate.id === decodedOrganizationId
	);

	if (!organization) notFound();

	return (
		<main className="shell">
			<PageHeading
				description="Explore organizations, validator sets, TOML state, Horizon URLs, and subquorum availability."
				eyebrow={network.name}
				title="Organizations"
				aside={
					<div className="heading-metrics">
						<strong>{formatInteger(network.organizations.length)}</strong>
						<span>discovered</span>
						<strong>
							{formatInteger(
								getTopOrganizations(network.organizations).at(0)?.validators
									.length ?? 0
							)}
						</strong>
						<span>largest validator set</span>
					</div>
				}
			/>
			<OrganizationTable
				organizations={network.organizations}
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
					<OrganizationDetail network={network} organization={organization} />
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
