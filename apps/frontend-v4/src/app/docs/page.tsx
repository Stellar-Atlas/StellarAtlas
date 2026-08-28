import { redirect } from 'next/navigation';
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
			'/v1/statistics?from=:iso&to=:iso',
			'/v1/day-statistics?from=:iso&to=:iso',
			'/v1/month-statistics?from=:iso&to=:iso',
			'/v1/scp-statements?limit=:limit',
			'/v1/scp-statements?nodeId=:publicKey',
			'/v1/scp-statements?slotIndex=:slot',
			'/v1/scp/slots/:slotIndex/transactions'
		],
		title: 'Inspect the current network'
	},
	{
		description:
			'Validator, node, and organization inventory with snapshots and time-window metrics.',
		endpoints: [
			'/v1/nodes',
			'/v1/nodes/:publicKey',
			'/v1/nodes/:publicKey/snapshots',
			'/v1/known/nodes?scope=:scope&limit=:limit&offset=:offset',
			'/v1/known/nodes/:publicKey',
			'/v1/node-snapshots',
			'/v1/nodes/:publicKey/statistics?from=:iso&to=:iso',
			'/v1/nodes/:publicKey/day-statistics?from=:iso&to=:iso',
			'/v1/organizations',
			'/v1/organizations/:organizationId',
			'/v1/organizations/:organizationId/snapshots',
			'/v1/known/organizations?scope=:scope&limit=:limit&offset=:offset',
			'/v1/known/organizations/:organizationId',
			'/v1/organization-snapshots',
			'/v1/organizations/:organizationId/statistics?from=:iso&to=:iso',
			'/v1/organizations/:organizationId/day-statistics?from=:iso&to=:iso'
		],
		title: 'Find a node or organization'
	},
	{
		description:
			'Current archive state, validator-owned evidence, object failures, and generated repair plans for exact history archive roots.',
		endpoints: [
			'/v1/known/nodes/:publicKey/archive-evidence',
			'/v1/known/organizations/:organizationId/archive-evidence',
			'/v1/archive-scans/objects/status-summary',
			'/v1/archive-scans/objects?status=:status&page=:page',
			'/v1/archive-scans/objects/buckets/:bucketHash/coverage',
			'/v1/archive-scans/:encodedUrl/state',
			'/v1/archive-scans/:encodedUrl/objects',
			'/v2/archive-scans/:encodedUrl/object-evidence',
			'/v1/archive-scans/:encodedUrl/repair-plan'
		],
		title: 'Verify a history archive'
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
		title: 'Check data and service status'
	},
	{
		description:
			'Read-only access to the owned Horizon API, the official SEP-54 Galexie object store, and StellarAtlas immutable decoded-history batches. The decoded LedgerCloseMeta stream begins at ledger 2: ledger 1 is the synthetic genesis header with no close transition, and ledger 2 is an empty-transaction close linked to that genesis hash. The decoded batch format is not SEP-54 object geometry.',
		endpoints: [
			'/horizon/',
			'/galexie/.config.json',
			'/galexie/:sep54ObjectPath',
			'/v1/history-data/catalog',
			'/v1/history-data/batches?dataset=:dataset&limit=:limit&beforeLedger=:ledger',
			'/v1/history-data/batches/:batchId/:dataset'
		],
		title: 'Access historical data'
	},
	{
		description:
			'Faceted lookup with bounded offset pagination and explicit totalIsExact metadata. archiveStatus=issue includes confirmed remote archive errors and current unreachable roots; scanner-issue remains a separate infrastructure status.',
		endpoints: [
			'/v1/search',
			'/v1/search/nodes?scope=current-validator&validator=true&archiveStatus=issue&limit=25&offset=0',
			'/v1/search/nodes?scope=current-validator&validator=true&archiveStatus=error',
			'/v1/search/organizations'
		],
		title: 'Search known network entities'
	},
	{
		description: 'Explorer lookup and current full-history read-model state.',
		endpoints: [
			'/v1/ledger/latest',
			'/v1/transactions/:hash',
			'/v1/explorer/search',
			'/v1/explorer/transactions',
			'/v1/explorer/transactions/:hash',
			'/v1/explorer/transactions/:hash/operations',
			'/v1/explorer/ledgers/:sequence',
			'/v1/explorer/accounts/:accountId',
			'/v1/explorer/assets',
			'/v1/explorer/operations',
			'/v1/explorer/contracts/:contractId',
			'/v1/status/full-history'
		],
		title: 'Explore ledger history'
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
		title: 'Inspect quorum evidence'
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
		title: 'Manage notifications'
	}
];

export default function DocsPage(): React.JSX.Element {
	redirect('/api-docs?view=swagger');
	return (
		<main className="shell">
			<PageHeading
				description="Stable public endpoints grouped by the task they perform."
				eyebrow="API"
				title="Developer reference"
			/>
			<section className="panel docs-panel">
				<a className="primary-button" href="/api-docs?view=swagger">
					Open Swagger documentation
				</a>
				<code>/v1</code>
				<p className="muted-inline">
					This page and Swagger list public read surfaces. Authenticated
					coordinator, worker, and backfill routes are intentionally excluded.
				</p>
				<div className="endpoint-grid">
					{endpointGroups.map((group) => (
						<section className="endpoint-group" key={group.title}>
							<div>
								<h2>{group.title}</h2>
								<p>{group.description}</p>
							</div>
							<div className="endpoint-paths">
								{group.endpoints.map((endpoint) => (
									<code key={endpoint}>{endpoint}</code>
								))}
							</div>
						</section>
					))}
				</div>
			</section>
		</main>
	);
}
