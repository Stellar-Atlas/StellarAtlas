import { Suspense } from 'react';
import { fetchPublicNetwork } from '../../api/client';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import { OrganizationTable } from '../../components/organizations/organization-table';
import { getTopOrganizations } from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const dynamic = 'force-dynamic';

async function OrganizationsRouteContent(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();
	const topOrganizations = getTopOrganizations(network.organizations);

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
							{formatInteger(topOrganizations.at(0)?.validators.length ?? 0)}
						</strong>
						<span>largest validator set</span>
					</div>
				}
			/>
			<OrganizationTable organizations={network.organizations} />
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
