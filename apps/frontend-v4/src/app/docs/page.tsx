import { fetchPublicNetwork } from '../../api/client';
import { AppShell } from '../../components/layout/app-shell';
import { PageHeading } from '../../components/layout/page-heading';

export const dynamic = 'force-dynamic';

interface EndpointGroup {
	description: string;
	endpoints: string[];
	title: string;
}

const endpointGroups: EndpointGroup[] = [
	{
		description: 'Current network snapshot, aggregate history, and SCP observations.',
		endpoints: [
			'/v1',
			'/v1/statistics?from=:iso&to=:iso',
			'/v1/day-statistics?from=:iso&to=:iso',
			'/v1/month-statistics?from=:iso&to=:iso',
			'/v1/scp-statements?limit=:limit',
			'/v1/scp-statements?nodeId=:publicKey',
			'/v1/scp-statements?slotIndex=:slot'
		],
		title: 'Network'
	},
	{
		description: 'Node inventory, current detail, snapshots, and time-window metrics.',
		endpoints: [
			'/v1/nodes',
			'/v1/nodes/:publicKey',
			'/v1/nodes/:publicKey/snapshots',
			'/v1/node-snapshots',
			'/v1/node/:publicKey/statistics?from=:iso&to=:iso',
			'/v1/node/:publicKey/day-statistics?from=:iso&to=:iso'
		],
		title: 'Nodes'
	},
	{
		description: 'Organization metadata, validator membership, and subquorum history.',
		endpoints: [
			'/v1/organizations',
			'/v1/organizations/:organizationId',
			'/v1/organizations/:organizationId/snapshots',
			'/v1/organization-snapshots',
			'/v1/organization/:organizationId/statistics?from=:iso&to=:iso',
			'/v1/organization/:organizationId/day-statistics?from=:iso&to=:iso'
		],
		title: 'Organizations'
	},
	{
		description: 'Latest public archive verification evidence for a normalized archive URL.',
		endpoints: ['/v1/history-scan/:encodedHistoryUrl'],
		title: 'History archive'
	},
	{
		description: 'Notification subscription management for network, node, and organization events.',
		endpoints: [
			'POST /v1/subscription',
			'POST /v1/subscription/request-unsubscribe',
			'POST /v1/subscription/:pendingSubscriptionId/confirm',
			'POST /v1/subscription/:subscriberRef/unmute',
			'DELETE /v1/subscription/:subscriberRef'
		],
		title: 'Subscriptions'
	}
];

export default async function DocsPage(): Promise<React.JSX.Element> {
	const network = await fetchPublicNetwork();

	return (
		<AppShell network={network}>
			<main className="shell">
				<PageHeading
					description="Primary public API endpoints for the current explorer data model."
					eyebrow="API"
					title="Developer reference"
				/>
				<section className="panel docs-panel">
					<a className="primary-button" href="/api-docs">
						Open Swagger documentation
					</a>
					<code>/v1</code>
					<div className="endpoint-grid">
						{endpointGroups.map((group) => (
							<article className="endpoint-card" key={group.title}>
								<span>{group.title}</span>
								<p>{group.description}</p>
								{group.endpoints.map((endpoint) => (
									<code key={endpoint}>{endpoint}</code>
								))}
							</article>
						))}
					</div>
				</section>
			</main>
		</AppShell>
	);
}
