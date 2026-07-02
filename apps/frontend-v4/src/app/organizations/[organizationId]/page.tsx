import { notFound } from 'next/navigation';
import Link from 'next/link';
import { fetchPublicNetwork } from '../../../api/client';
import { AppShell } from '../../../components/layout/app-shell';
import { PageHeading } from '../../../components/layout/page-heading';
import { OrganizationDetail } from '../../../components/organizations/organization-detail';
import { OrganizationTable } from '../../../components/organizations/organization-table';
import { getTopOrganizations } from '../../../domain/network';
import { formatInteger } from '../../../format/formatters';

interface OrganizationDetailPageProps {
	params: Promise<{ organizationId: string }>;
}

export const dynamic = 'force-dynamic';

export default async function OrganizationDetailPage({
	params
}: OrganizationDetailPageProps): Promise<React.JSX.Element> {
	const { organizationId } = await params;
	const decodedOrganizationId = decodeURIComponent(organizationId);
	const network = await fetchPublicNetwork();
	const organization = network.organizations.find(
		(candidate) => candidate.id === decodedOrganizationId
	);

	if (!organization) notFound();

	return (
		<AppShell network={network}>
			<main className="shell">
				<PageHeading
					description="Explore organizations, validator sets, TOML state, Horizon URLs, and subquorum availability."
					eyebrow={network.name}
					title="Organizations"
					aside={
						<div className="heading-metrics">
							<strong>{formatInteger(network.organizations.length)}</strong>
							<span>discovered</span>
							<strong>{formatInteger(getTopOrganizations(network.organizations).at(0)?.validators.length ?? 0)}</strong>
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
								<h2>{organization.name ?? organization.dba ?? organization.homeDomain}</h2>
							</div>
							<Link className="close-route-modal" href="/organizations">
								Close
							</Link>
						</div>
						<OrganizationDetail network={network} organization={organization} />
					</section>
				</div>
			</main>
		</AppShell>
	);
}
