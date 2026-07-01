import { notFound } from 'next/navigation';
import { fetchPublicNetwork } from '../../../api/client';
import { AppShell } from '../../../components/layout/app-shell';
import { PageHeading } from '../../../components/layout/page-heading';
import { OrganizationDetail } from '../../../components/organizations/organization-detail';
import { getOrganizationLabel } from '../../../domain/network';

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
					description={organization.homeDomain}
					eyebrow="Organization"
					title={getOrganizationLabel(organization)}
				/>
				<OrganizationDetail network={network} organization={organization} />
			</main>
		</AppShell>
	);
}
