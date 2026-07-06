import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchKnownOrganizations, fetchPublicNetwork } from '../../api/client';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import { OrganizationTable } from '../../components/organizations/organization-table';
import { getTopOrganizations } from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const revalidate = 10;

async function OrganizationsRouteContent(): Promise<React.JSX.Element> {
	await connection();
	const [network, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownOrganizations({ revalidate })
	]);
	const organizations = knownOrganizations.organizations.map(
		(knownOrganization) => knownOrganization.organization
	);
	const topOrganizations = getTopOrganizations(organizations);

	return (
		<main className="shell">
			<PageHeading
				description="Explore organizations, validator sets, stored stellar.toml state, public ledger API URLs, and quorum-path availability."
				eyebrow={network.name}
				title="Organizations"
				aside={
					<div className="heading-metrics">
						<strong>{formatInteger(knownOrganizations.count)}</strong>
						<span>discovered</span>
						<strong>
							{formatInteger(topOrganizations.at(0)?.validators.length ?? 0)}
						</strong>
						<span>largest validator set</span>
					</div>
				}
			/>
			<OrganizationTable organizations={knownOrganizations.organizations} />
		</main>
	);
}

export default function OrganizationsPage(): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<OrganizationsRouteContent />
		</Suspense>
	);
}
