import { PageHeading } from '../../components/layout/page-heading';

interface EndpointGroup {
	description: string;
	endpoints: string[];
	title: string;
}

const endpointGroups: EndpointGroup[] = [
	{
		description:
			'Current network snapshot, ledger state, aggregate history, and SCP observations.',
		endpoints: [
			'/v1',
			'/v1/ledger/latest',
			'/v1/statistics?from=:iso&to=:iso',
			'/v1/day-statistics?from=:iso&to=:iso',
			'/v1/month-statistics?from=:iso&to=:iso',
			'/v1/scp-statements?limit=:limit',
			'/v1/scp-statements?nodeId=:publicKey',
			'/v1/scp-statements?slotIndex=:slot',
			'/v1/scp/slots/:slotIndex/transactions',
			'/v1/transactions/:hash'
		],
		title: 'Network'
	},
	{
		description:
			'Validator, node, and organization inventory with snapshots and time-window metrics.',
		endpoints: [
			'/v1/nodes',
			'/v1/nodes/:publicKey',
			'/v1/nodes/:publicKey/snapshots',
			'/v1/node-snapshots',
			'/v1/node/:publicKey/statistics?from=:iso&to=:iso',
			'/v1/node/:publicKey/day-statistics?from=:iso&to=:iso',
			'/v1/organizations',
			'/v1/organizations/:organizationId',
			'/v1/organizations/:organizationId/snapshots',
			'/v1/organization-snapshots',
			'/v1/organization/:organizationId/statistics?from=:iso&to=:iso',
			'/v1/organization/:organizationId/day-statistics?from=:iso&to=:iso'
		],
		title: 'Validators and organizations'
	},
	{
		description:
			'Public archive verification summaries, error logs, and captured evidence for normalized history archive URLs.',
		endpoints: [
			'/v1/archive-scans',
			'/v1/archive-scans/:encodedUrl',
			'/v1/archive-scans/:encodedUrl/errors',
			'/v1/archive-scans/:encodedUrl/evidence',
			'/v1/archive-scans/:encodedUrl/object-evidence',
			'/v1/archive-scans/:encodedUrl/repair-plan'
		],
		title: 'Archive verification'
	},
	{
		description:
			'Read-only status, freshness, continuity, and ingestion evidence.',
		endpoints: [
			'/v1/status',
			'/v1/status/api',
			'/v1/status/data-quality',
			'/v1/status/data-freshness',
			'/v1/status/scans',
			'/v1/status/rollups',
			'/v1/status/full-history',
			'/v1/status/ingestion'
		],
		title: 'Status and freshness'
	},
	{
		description:
			'Faceted lookup across current network entities with read-model fallback metadata.',
		endpoints: ['/v1/search', '/v1/search/nodes', '/v1/search/organizations'],
		title: 'Search'
	},
	{
		description:
			'Horizon-backed explorer lookup and current full-history read-model state.',
		endpoints: [
			'/v1/explorer/search',
			'/v1/explorer/transactions',
			'/v1/explorer/transactions/:hash',
			'/v1/explorer/transactions/:hash/operations',
			'/v1/explorer/ledgers/:sequence',
			'/v1/explorer/accounts/:accountId',
			'/v1/explorer/assets',
			'/v1/explorer/contracts/:contractId',
			'/v1/explorer/local-read-model'
		],
		title: 'Explorer'
	},
	{
		description:
			'Persisted quorum-set, top-tier, blocking-set, and splitting-set evidence.',
		endpoints: [
			'/v1/fbas/latest',
			'/v1/fbas/analyses/:scanId',
			'/v1/fbas/analyses/:scanId/proof',
			'/v1/fbas/top-tier/history?from=:date&to=:date',
			'/v1/fbas/blocking-sets/latest',
			'/v1/fbas/splitting-sets/latest'
		],
		title: 'FBAS and quorum'
	},
	{
		description:
			'Persisted external comparison evidence for RADAR parity and API-doc drift review.',
		endpoints: [
			'/v1/cross-check/sources',
			'/v1/cross-check/validators',
			'/v1/cross-check/organizations',
			'/v1/cross-check/archives',
			'/v1/cross-check/api-docs/latest',
			'/v1/cross-check/api-docs/snapshots',
			'/v1/cross-check/radar-network/latest',
			'/v1/cross-check/radar-network/snapshots'
		],
		title: 'Cross-source review'
	},
	{
		description:
			'Notification subscription management for network, node, and organization events.',
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

export default function DocsPage(): React.JSX.Element {
	return (
		<main className="shell">
			<PageHeading
				description="Primary public API endpoints for the current explorer data model."
				eyebrow="API"
				title="Developer reference"
			/>
			<section className="panel docs-panel">
				<a className="primary-button" href="/api-docs/">
					Open Swagger documentation
				</a>
				<code>/v1</code>
				<p className="muted-inline">
					This page lists public read surfaces. Authenticated coordinator,
					worker, and backfill routes remain in Swagger for operators.
				</p>
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
	);
}
