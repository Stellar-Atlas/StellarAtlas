import {
	projectOpenApiDocument,
	readOpenApiStringArray,
	type OpenApiOperationContext,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';
import { isPublicOpenApiOperation } from './OpenApiOperationClassification.js';

const publicServer = {
	description: 'API for the Stellar public network',
	url: 'https://api.stellaratlas.io'
};

const publicTagDefinitions = [
	{
		description: 'Current Stellar public-network state and measurements.',
		name: 'Network'
	},
	{
		description: 'Faceted lookup across indexed StellarAtlas read models.',
		name: 'Search'
	},
	{
		description: 'Current and all-known node inventory and measurements.',
		name: 'Nodes'
	},
	{
		description:
			'Current and all-known organization inventory and measurements.',
		name: 'Organizations'
	},
	{
		description:
			'History archive state, object verification, evidence, and repair views.',
		name: 'Archive verification'
	},
	{
		description: 'StellarAtlas service, scanner, and data-freshness status.',
		name: 'Status'
	},
	{
		description: 'Canonical full-history ingestion and indexing progress.',
		name: 'Full-history ingestion'
	},
	{
		description: 'Federated Byzantine Agreement System quorum evidence.',
		name: 'FBAS'
	},
	{
		description: 'Observed Stellar Consensus Protocol evidence.',
		name: 'SCP'
	},
	{
		description: 'Canonical ledger, transaction, account, and asset lookup.',
		name: 'Explorer'
	},
	{
		description: 'Notification subscription management.',
		name: 'Notifications'
	}
] as const;

export function createPublicOpenApiDocument(document: unknown): OpenApiRecord {
	return projectOpenApiDocument(document, {
		includeOperation: isPublicOpenApiOperation,
		info: {
			description:
				'Canonical public read and notification endpoints provided by StellarAtlas.',
			title: 'StellarAtlas Public API'
		},
		servers: [publicServer],
		tags: publicTagDefinitions,
		transformOperation: canonicalizePublicOperation
	});
}

function canonicalizePublicOperation(
	context: OpenApiOperationContext
): OpenApiRecord {
	return {
		...context.operation,
		tags: [canonicalPublicTag(context.path, context.operation.tags)]
	};
}

function canonicalPublicTag(path: string, value: unknown): string {
	const sourceTags = readOpenApiStringArray(value);
	if (path.startsWith('/v1/search')) return 'Search';
	if (path.includes('/archive-evidence')) return 'Archive verification';
	if (
		path.startsWith('/v1/archive-scans') ||
		path.startsWith('/v2/archive-scans')
	) {
		return 'Archive verification';
	}
	if (
		path.startsWith('/v1/known/nodes') ||
		path.startsWith('/v1/nodes') ||
		path === '/v1/node-snapshots'
	) {
		return 'Nodes';
	}
	if (
		path.startsWith('/v1/known/organizations') ||
		path.startsWith('/v1/organizations') ||
		path === '/v1/organization-snapshots'
	) {
		return 'Organizations';
	}
	if (path.startsWith('/v1/status')) return 'Status';
	if (
		path.startsWith('/v1/indexing') ||
		/^\/v1\/ledgers\/[^/]+\/ingestion-status$/.test(path)
	) {
		return 'Full-history ingestion';
	}
	if (path.startsWith('/v1/fbas')) return 'FBAS';
	if (path.startsWith('/v1/scp') || path.startsWith('/v1/scp-statements')) {
		return 'SCP';
	}
	if (
		path.startsWith('/v1/explorer') ||
		path.startsWith('/v1/transactions') ||
		path === '/v1/ledger/latest'
	) {
		return 'Explorer';
	}
	if (path.startsWith('/v1/subscription')) return 'Notifications';
	return sourceTags[0] ?? 'Network';
}
