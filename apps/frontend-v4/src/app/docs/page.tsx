import { fetchPublicNetwork, getApiBaseUrl } from '../../api/client';
import { AppShell } from '../../components/layout/app-shell';
import { PageHeading } from '../../components/layout/page-heading';

export const dynamic = 'force-dynamic';

export default async function DocsPage(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();
	const apiBaseUrl = getApiBaseUrl();

	return (
		<AppShell network={network}>
			<main className="shell">
				<PageHeading
					description="Primary public API endpoints for the current explorer data model."
					eyebrow="API"
					title="Developer reference"
				/>
				<section className="panel docs-panel">
					<a href={`${apiBaseUrl}/docs`}>Open Swagger documentation</a>
					<code>{apiBaseUrl}/v1</code>
					<code>{apiBaseUrl}/v1/nodes</code>
					<code>{apiBaseUrl}/v1/organizations</code>
					<code>{apiBaseUrl}/v1/node/:publicKey/day-statistics</code>
					<code>{apiBaseUrl}/v1/organization/:id/day-statistics</code>
				</section>
			</main>
		</AppShell>
	);
}
