import { Suspense } from 'react';
import { connection } from 'next/server';
import { fetchKnownOrganizations, fetchPublicNetwork } from '../../api/client';
import { PageHeading } from '../../components/layout/page-heading';
import { RouteLoadingPanel } from '../../components/layout/route-fallbacks';
import { OrganizationTable } from '../../components/organizations/organization-table';
import { getTopOrganizations } from '../../domain/network';
import { formatInteger } from '../../format/formatters';

export const revalidate = 10;

interface OrganizationsRouteProps {
	readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function OrganizationsRouteContent({
	searchParams
}: OrganizationsRouteProps): Promise<React.JSX.Element> {
	await connection();
	const params = await searchParams;
	const scope = parseOrganizationScope(params.scope);
	const page = parsePage(params.page);
	const query = singleValue(params.q)?.slice(0, 128) ?? '';
	const limit = 25;
	const [network, knownOrganizations] = await Promise.all([
		fetchPublicNetwork({ revalidate }),
		fetchKnownOrganizations(
			{ limit, offset: (page - 1) * limit, query, scope },
			{ revalidate }
		)
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
			<OrganizationTable
				organizations={knownOrganizations.organizations}
				page={knownOrganizations.page}
				query={query}
				scope={scope}
				totalCount={knownOrganizations.scopeTotals['all-known']}
			/>
		</main>
	);
}

export default function OrganizationsPage(
	props: OrganizationsRouteProps
): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<OrganizationsRouteContent {...props} />
		</Suspense>
	);
}

function singleValue(value: string | string[] | undefined): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function parsePage(value: string | string[] | undefined): number {
	const parsed = Number(singleValue(value));
	return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function parseOrganizationScope(value: string | string[] | undefined) {
	const scope = singleValue(value);
	return scope === 'archived' || scope === 'all-known' ? scope : 'current';
}
