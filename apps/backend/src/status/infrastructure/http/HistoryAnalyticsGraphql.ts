import type { RequestHandler } from 'express';
import { buildSchema, GraphQLError } from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';
import {
	HistoryAnalyticsInputError,
	type HistoryAnalyticsRouterConfig,
	queryAssetHolder
} from './HistoryAnalyticsRouter.js';

const schema = buildSchema(`
	type Query {
		hubbleStatus: HubbleStatus!
		assetHolder(assetId: String!, address: String!): AssetHolderResult!
	}

	type HubbleStatus {
		compatibility: String!
		officialSchemaSource: String!
		servingWarehouse: String!
		availableQueries: [String!]!
	}

	type AssetHolderResult {
		address: String!
		asset: AssetIdentity!
		coverage: DatasetCoverage!
		generatedAt: String!
		holder: AssetHolder
	}

	type AssetIdentity {
		canonical: String!
		code: String
		issuer: String
		type: String!
	}

	type DatasetCoverage {
		complete: Boolean!
		completeBatchCount: Int!
		dataset: String!
		importedRecordCount: String!
		immutableSource: String!
		maximumImportedLedger: String
		minimumImportedLedger: String
		servingSource: String!
		totalBatchCount: Int!
		totalRecordCount: String!
	}

	type AssetHolder {
		accountId: String!
		active: Boolean!
		assetType: Int!
		assetTypeString: String!
		authorized: Boolean
		authorizedToMaintainLiabilities: Boolean
		balance: String!
		buyingLiabilities: String!
		changeIndex: String!
		clawbackEnabled: Boolean
		closedAt: String!
		deleted: Boolean!
		flags: String!
		lastModifiedLedger: String!
		ledgerSequence: String!
		limit: String
		operationIndex: String
		reason: String!
		sellingLiabilities: String!
		transactionHash: String
		transactionIndex: String!
	}
`
);

interface AssetHolderArguments {
	readonly address: string;
	readonly assetId: string;
}

export function historyAnalyticsGraphqlHandler(
	config: HistoryAnalyticsRouterConfig
): RequestHandler {
	return createHandler({
		schema,
		rootValue: {
			hubbleStatus: () => ({
				availableQueries: ['assetHolder'],
				compatibility: 'building',
				officialSchemaSource:
					'github.com/stellar/stellar-etl/v2/internal/transform',
				servingWarehouse: 'postgresql-operational-projection'
			}),
			assetHolder: async ({ address, assetId }: AssetHolderArguments) => {
				try {
					return await queryAssetHolder(config, assetId, address);
				} catch (error) {
					if (error instanceof HistoryAnalyticsInputError) {
						throw new GraphQLError(error.message, {
							extensions: { code: 'BAD_USER_INPUT' }
						});
					}
					throw new GraphQLError(
						'Historical asset holder query is unavailable',
						{ extensions: { code: 'SERVICE_UNAVAILABLE' } }
					);
				}
			}
		}
	});
}
