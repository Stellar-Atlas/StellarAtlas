import type { OpenApiOperationContext } from './OpenApiDocumentProjection.js';

// Reviewed consumer-facing contract. New operations require an explicit review here.
// Bind identity to method/path so reusing an allowed name cannot publish a new route.
const publicOperations = new Map<string, string>([
	['callStellarRpc', 'post /rpc'],
	[
		'confirmSubscription',
		'post /v1/subscription/{pendingSubscriptionId}/confirm'
	],
	['createSubscription', 'post /v1/subscription'],
	[
		'downloadHistoryDataBatchArtifact',
		'get /v1/history-data/batches/{batchId}/{dataset}'
	],
	[
		'getAnalyticsAssetHolder',
		'get /v1/analytics/assets/{asset}/holders/{account}'
	],
	['getAnalyticsLedger', 'get /v1/analytics/ledgers/{sequence}'],
	['getAnalyticsOperation', 'get /v1/analytics/operations/{operationId}'],
	[
		'getAnalyticsTransaction',
		'get /v1/analytics/transactions/{transactionHash}'
	],
	['getApiStatus', 'get /v1/status/api'],
	['getDataFreshnessStatus', 'get /v1/status/data-freshness'],
	['getDataQualityStatus', 'get /v1/status/data-quality'],
	['getExplorerAccount', 'get /v1/explorer/accounts/{accountId}'],
	[
		'getExplorerAccountObservations',
		'get /v1/explorer/accounts/{accountId}/observations'
	],
	['getExplorerAssets', 'get /v1/explorer/assets'],
	['getExplorerContract', 'get /v1/explorer/contracts/{contractId}'],
	['getExplorerLedger', 'get /v1/explorer/ledgers/{sequence}'],
	['getExplorerOperations', 'get /v1/explorer/operations'],
	['getExplorerRecentTransactions', 'get /v1/explorer/transactions'],
	['getExplorerTransactionByHash', 'get /v1/explorer/transactions/{hash}'],
	[
		'getExplorerTransactionOperations',
		'get /v1/explorer/transactions/{hash}/operations'
	],
	['getFbasAnalysis', 'get /v1/fbas/analyses/{scanId}'],
	['getFbasAnalysisProof', 'get /v1/fbas/analyses/{scanId}/proof'],
	['getFbasTopTierHistory', 'get /v1/fbas/top-tier/history'],
	['getFrontendStatus', 'get /v1/status/frontend'],
	['getFullHistoryStatus', 'get /v1/status/full-history'],
	['getGalexieConfiguration', 'get /galexie/.config.json'],
	[
		'getHistoryArchiveBucketCoverage',
		'get /v1/archive-scans/objects/buckets/{bucketHash}/coverage'
	],
	['getHistoryArchiveObjectEvents', 'get /v1/archive-scans/objects/events'],
	[
		'getHistoryArchiveObjectEventsByUrl',
		'get /v1/archive-scans/{encodedUrl}/objects/events'
	],
	[
		'getHistoryArchiveObjectEvidenceV2ByUrl',
		'get /v2/archive-scans/{encodedUrl}/object-evidence'
	],
	['getHistoryArchiveObjects', 'get /v1/archive-scans/objects'],
	[
		'getHistoryArchiveObjectsByUrl',
		'get /v1/archive-scans/{encodedUrl}/objects'
	],
	[
		'getHistoryArchiveObjectStatusSummary',
		'get /v1/archive-scans/objects/status-summary'
	],
	['getHistoryArchiveObjectSummary', 'get /v1/archive-scans/objects/summary'],
	[
		'getHistoryArchiveObjectSummaryByUrl',
		'get /v1/archive-scans/{encodedUrl}/objects/summary'
	],
	[
		'getHistoryArchiveRepairPlan',
		'get /v1/archive-scans/{encodedUrl}/repair-plan'
	],
	['getHistoryArchiveStateByUrl', 'get /v1/archive-scans/{encodedUrl}/state'],
	['getHistoryDataCatalog', 'get /v1/history-data/catalog'],
	['getHorizonRoot', 'get /horizon/'],
	['getHorizonStatus', 'get /v1/status/horizon'],
	['getHubbleDataset', 'get /v1/analytics/datasets/{dataset}'],
	['getIndexingRanges', 'get /v1/indexing/ranges'],
	['getIngestionStatus', 'get /v1/status/ingestion'],
	['getKnownNode', 'get /v1/known/nodes/{publicKey}'],
	[
		'getKnownNodeArchiveEvidence',
		'get /v1/known/nodes/{publicKey}/archive-evidence'
	],
	['getKnownNodes', 'get /v1/known/nodes'],
	['getKnownOrganization', 'get /v1/known/organizations/{organizationId}'],
	[
		'getKnownOrganizationArchiveEvidence',
		'get /v1/known/organizations/{organizationId}/archive-evidence'
	],
	['getKnownOrganizations', 'get /v1/known/organizations'],
	['getLatestFbas', 'get /v1/fbas/latest'],
	['getLatestFbasBlockingSets', 'get /v1/fbas/blocking-sets/latest'],
	['getLatestFbasSplittingSets', 'get /v1/fbas/splitting-sets/latest'],
	['getLatestLedger', 'get /v1/ledger/latest'],
	['getLedgerIngestionStatus', 'get /v1/ledgers/{sequence}/ingestion-status'],
	['getLedgerTransactions', 'get /v1/scp/slots/{slotIndex}/transactions'],
	['getNetwork', 'get /v1'],
	['getNetworkDayStatistics', 'get /v1/day-statistics'],
	['getNetworkMonthStatistics', 'get /v1/month-statistics'],
	['getNetworkNodeSnapshots', 'get /v1/node-snapshots'],
	['getNetworkOrganizationSnapshots', 'get /v1/organization-snapshots'],
	['getNetworkStatistics', 'get /v1/statistics'],
	['getNodeByPublicKey', 'get /v1/nodes/{publicKey}'],
	['getNodeDayStatistics', 'get /v1/nodes/{publicKey}/day-statistics'],
	['getNodes', 'get /v1/nodes'],
	['getNodeSnapshots', 'get /v1/nodes/{publicKey}/snapshots'],
	['getNodeStatistics', 'get /v1/nodes/{publicKey}/statistics'],
	['getOrganizationById', 'get /v1/organizations/{id}'],
	['getOrganizationDayStatistics', 'get /v1/organizations/{id}/day-statistics'],
	['getOrganizations', 'get /v1/organizations'],
	['getOrganizationSnapshots', 'get /v1/organizations/{id}/snapshots'],
	['getOrganizationStatistics', 'get /v1/organizations/{id}/statistics'],
	['getParsedAsset', 'get /v1/analytics/assets/{asset}'],
	['getParsedContract', 'get /v1/analytics/contracts/{contractId}'],
	['getParsedOffer', 'get /v1/analytics/offers/{offerId}'],
	['getParsedTrade', 'get /v1/analytics/trades/{tradeId}'],
	['getRpcStatus', 'get /v1/status/rpc'],
	['getScanStatus', 'get /v1/status/scans'],
	['getScpStatements', 'get /v1/scp-statements'],
	['getStatus', 'get /v1/status'],
	['getTransactionByHash', 'get /v1/transactions/{hash}'],
	[
		'headHistoryDataBatchArtifact',
		'head /v1/history-data/batches/{batchId}/{dataset}'
	],
	[
		'listAnalyticsAccountBalances',
		'get /v1/analytics/accounts/{account}/balances'
	],
	[
		'listAnalyticsAccountEffects',
		'get /v1/analytics/accounts/{account}/effects'
	],
	[
		'listAnalyticsAccountTransactions',
		'get /v1/analytics/accounts/{account}/transactions'
	],
	[
		'listAnalyticsAccountTransferActivity',
		'get /v1/analytics/accounts/{account}/activity/transfers'
	],
	['listAnalyticsAssetHolders', 'get /v1/analytics/assets/{asset}/holders'],
	[
		'listAnalyticsAssetTransferActivity',
		'get /v1/analytics/assets/{asset}/activity/transfers'
	],
	['listAnalyticsAssetTransfers', 'get /v1/analytics/assets/{asset}/transfers'],
	[
		'listAnalyticsContractEvents',
		'get /v1/analytics/contracts/{contractId}/events'
	],
	[
		'listAnalyticsContractState',
		'get /v1/analytics/contracts/{contractId}/state'
	],
	[
		'listAnalyticsLedgerTransactions',
		'get /v1/analytics/ledgers/{sequence}/transactions'
	],
	[
		'listAnalyticsOperationEffects',
		'get /v1/analytics/operations/{operationId}/effects'
	],
	['listCurrentAssetHolders', 'get /v1/analytics/assets/holders'],
	['listHistoryDataBatches', 'get /v1/history-data/batches'],
	['listHubbleDatasets', 'get /v1/analytics/datasets'],
	['listParsedAssets', 'get /v1/analytics/assets'],
	['listParsedContracts', 'get /v1/analytics/contracts'],
	['listParsedOffers', 'get /v1/analytics/offers'],
	['listParsedOperations', 'get /v1/analytics/operations'],
	['postAnalyticsGraphql', 'post /graphql'],
	['queryHubbleDataset', 'post /v1/analytics/datasets/{dataset}/query'],
	['queryHubbleDatasetResource', 'get /v1/analytics/{dataset}'],
	['queryHubbleGraphqlGet', 'get /graphql'],
	['queryHubbleWarehouse', 'post /v1/analytics/query'],
	['requestUnsubscribeLink', 'post /v1/subscription/request-unsubscribe'],
	['searchAnalyticsTrades', 'get /v1/analytics/trades'],
	['searchAnalyticsTransferActivity', 'get /v1/analytics/activity/transfers'],
	['searchAnalyticsTransfers', 'get /v1/analytics/transfers'],
	['searchExplorer', 'get /v1/explorer/search'],
	['searchNetworkEntities', 'get /v1/search'],
	['searchNetworkNodes', 'get /v1/search/nodes'],
	['searchNetworkOrganizations', 'get /v1/search/organizations'],
	['streamNetwork', 'get /v1/live'],
	['unmuteSubscription', 'post /v1/subscription/{subscriberRef}/unmute'],
	['unsubscribe', 'delete /v1/subscription/{subscriberRef}']
]);

export function isReviewedPublicOpenApiOperation({
	method,
	operation,
	path
}: OpenApiOperationContext): boolean {
	return (
		typeof operation.operationId === 'string' &&
		publicOperations.get(operation.operationId) === `${method} ${path}`
	);
}
