import { validateHubbleGraphqlBudget } from './HubbleGraphqlBudget.js';
import {
	hubbleAccountBalanceSchema,
	hubbleAccountBalanceResolvers
} from './HubbleAccountBalanceGraphql.js';
import {
	hubbleAssetHolderSchema,
	hubbleAssetHolderResolvers,
	configureHubbleAssetHolderScalar
} from './HubbleAssetHolderGraphql.js';
import {
	hubbleContractEventSchema,
	hubbleContractEventResolvers
} from './HubbleContractEventGraphql.js';
import {
	hubbleExplorerSchema,
	hubbleExplorerResolvers
} from './HubbleExplorerGraphql.js';
import {
	hubbleTransactionSchema,
	hubbleTransactionResolvers
} from './HubbleTransactionGraphql.js';
import type { RequestHandler } from 'express';
import type { HubbleAggregateFunction } from './HubbleAggregateContracts.js';
import {
	buildSchema,
	GraphQLError,
	GraphQLScalarType,
	valueFromASTUntyped
} from 'graphql';
import { createHandler } from 'graphql-http/lib/use/express';
import {
	HubbleWarehouseInputError,
	HubbleWarehouseUnavailableError,
	type HubbleFilter,
	type HubbleFilterOperator,
	type HubbleQuery,
	type HubbleWarehouse
} from './HubbleWarehouseClient.js';

import {
	hubbleTransferSchema,
	hubbleTransferResolvers
} from './HubbleTransferGraphql.js';

const schema = buildSchema(
	`
	scalar JSON

	type Query {
		hubbleStatus: HubbleStatus!
		hubbleDatasets: [HubbleDataset!]!
		hubbleQuery(input: HubbleQueryInput!): HubbleQueryResult!
	}

	type HubbleStatus {
		coverage: HubbleLedgerCoverage!
		availableQueries: [String!]!
		compatibility: String!
		completedBatches: String!
		datasetCount: Int!
		failedBatches: String!
		maximumLedger: String
		minimumLedger: String
		officialSchemaSource: String!
		servingWarehouse: String!
		totalRows: String!
	}

	type HubbleLedgerCoverage {
		completedRanges: [HubbleCompletedLedgerInterval!]
		contiguousFirstLedger: String
		contiguousLastLedger: String
		contiguousLedgerCount: String!
		supplementalLedgerCount: String!
		totalLedgerCount: String!
		nextLedger: String!
		minimumLedger: String
		maximumLedger: String
		gapCount: Int!
	}
	type HubbleCompletedLedgerInterval {
		firstLedger: String!
		lastLedger: String!
	}

	type HubbleDataset {
		columns: [HubbleColumn!]!
		name: String!
		rowCount: String!
	}

	type HubbleColumn {
		name: String!
		position: Int!
		type: String!
	}

	type HubbleQueryResult {
		columns: [String!]!
		dataset: String!
		elapsedMilliseconds: Float!
		limit: Int!
		offset: Float!
		rows: [JSON!]!
		aggregates: [HubbleAggregateColumn!]
		coverage: HubbleLedgerCoverage
		coverageStatus: String
		window: HubbleExplorerWindow
		nextOffset: Float
		semantics: String
	}
	type HubbleAggregateColumn {
		alias: String! function: String! field: String sourceType: String
		valueEncoding: String! approximate: Boolean!
	}

	input HubbleQueryInput {
		dataset: String!
		filters: [HubbleFilterInput!]
		limit: Int
		offset: Float
		orderBy: [HubbleOrderInput!]
		select: [String!]
		groupBy: [String!]
		aggregations: [HubbleAggregateInput!]
		minLedger: Int
		maxLedger: Int
	}
	input HubbleAggregateInput { function: HubbleAggregateFunction! field: String alias: String! }
	enum HubbleAggregateFunction { COUNT COUNT_DISTINCT SUM AVG MIN MAX }

	input HubbleFilterInput {
		field: String!
		operator: HubbleFilterOperator = EQ
		value: JSON
		values: [JSON!]
	}

	enum HubbleFilterOperator {
		CONTAINS
		EQ
		GT
		GTE
		IN
		IS_NOT_NULL
		IS_NULL
		LT
		LTE
		NE
	}

	input HubbleOrderInput {
		direction: HubbleOrderDirection = ASC
		field: String!
	}

	enum HubbleOrderDirection {
		ASC
		DESC
	}
` +
		hubbleTransferSchema +
		hubbleTransactionSchema +
		hubbleContractEventSchema +
		hubbleExplorerSchema +
		hubbleAssetHolderSchema +
		hubbleAccountBalanceSchema
);
configureHubbleAssetHolderScalar(schema);

const jsonScalar = schema.getType('JSON');
if (jsonScalar instanceof GraphQLScalarType) {
	Object.assign(jsonScalar, {
		parseLiteral: valueFromASTUntyped,
		parseValue: (value: unknown) => value,
		serialize: (value: unknown) => value
	});
}

interface GraphqlQueryArguments {
	readonly input: {
		readonly dataset: string;
		readonly filters?: readonly {
			readonly field: string;
			readonly operator?: string;
			readonly value?: unknown;
			readonly values?: readonly unknown[];
		}[];
		readonly limit?: number;
		readonly offset?: number;
		readonly orderBy?: readonly {
			readonly direction?: string;
			readonly field: string;
		}[];
		readonly select?: readonly string[];
		readonly groupBy?: readonly string[] | null;
		readonly aggregations?:
			| readonly {
					readonly function: string;
					readonly field?: string | null;
					readonly alias: string;
			  }[]
			| null;
		readonly minLedger?: number | null;
		readonly maxLedger?: number | null;
	};
}

export function hubbleWarehouseGraphqlHandler(
	warehouse: HubbleWarehouse
): RequestHandler {
	return createHandler({
		schema,
		validationRules: (_request, _args, specifiedRules) => [
			...specifiedRules,
			validateHubbleGraphqlBudget
		],
		rootValue: {
			...hubbleTransferResolvers(warehouse, mapGraphqlError),
			...hubbleTransactionResolvers(warehouse, mapGraphqlError),
			...hubbleContractEventResolvers(warehouse, mapGraphqlError),
			...hubbleExplorerResolvers(warehouse, mapGraphqlError),
			...hubbleAssetHolderResolvers(warehouse, mapGraphqlError),
			...hubbleAccountBalanceResolvers(warehouse, mapGraphqlError),
			hubbleDatasets: async () => (await warehouse.catalog()).datasets,
			hubbleQuery: async ({ input }: GraphqlQueryArguments) => {
				try {
					return await warehouse.query(mapQuery(input));
				} catch (error) {
					throw mapGraphqlError(error);
				}
			},
			hubbleStatus: async () => {
				try {
					const catalog = await warehouse.catalog();
					return {
						availableQueries: [
							'hubbleTransaction',
							'hubbleDatasets',
							'hubbleQuery',
							'hubbleTransfers',
							'hubbleAccountTransfers',
							'hubbleAssetTransfers',
							'hubbleContractEvents',
							'hubbleTrades',
							'hubbleTrade',
							'hubbleOffers',
							'hubbleOffer',
							'hubbleAssetHolders',
							'hubbleAssetHolder',
							'hubbleAccountBalances',
							'hubbleOperations',
							'hubbleOperation',
							'hubbleAssets',
							'hubbleAsset',
							'hubbleContracts',
							'hubbleContract'
						],
						compatibility: 'official-stellar-etl-schema',
						coverage: catalog.coverage,
						completedBatches: catalog.ingestion.completedBatches,
						datasetCount: catalog.datasets.length,
						failedBatches: catalog.ingestion.failedBatches,
						maximumLedger: catalog.ingestion.maximumLedger,
						minimumLedger: catalog.ingestion.minimumLedger,
						officialSchemaSource: catalog.officialSchemaSource,
						servingWarehouse: 'ClickHouse',
						totalRows: catalog.ingestion.totalRows
					};
				} catch (error) {
					throw mapGraphqlError(error);
				}
			}
		}
	});
}

function mapQuery(input: GraphqlQueryArguments['input']): HubbleQuery {
	return {
		dataset: input.dataset,
		filters: input.filters?.map((filter): HubbleFilter => ({
			field: filter.field,
			operator: mapOperator(filter.operator ?? 'EQ'),
			value: filter.value,
			values: filter.values
		})),
		limit: input.limit,
		offset: input.offset,
		orderBy: input.orderBy?.map((order) => ({
			direction:
				order.direction === undefined
					? undefined
					: (order.direction.toLowerCase() as 'asc' | 'desc'),
			field: order.field
		})),
		select: input.select,
		groupBy: input.groupBy ?? undefined,
		aggregations: input.aggregations?.map((metric) => ({
			function: mapAggregateFunction(metric.function),
			field: metric.field ?? undefined,
			alias: metric.alias
		})),
		minLedger: input.minLedger ?? undefined,
		maxLedger: input.maxLedger ?? undefined
	};
}

function mapAggregateFunction(value: string): HubbleAggregateFunction {
	const functions: Readonly<Record<string, HubbleAggregateFunction>> = {
		COUNT: 'count',
		COUNT_DISTINCT: 'count_distinct',
		SUM: 'sum',
		AVG: 'avg',
		MIN: 'min',
		MAX: 'max'
	};
	const result = functions[value];
	if (result === undefined)
		throw new HubbleWarehouseInputError(
			'Unsupported aggregate function: ' + value
		);
	return result;
}

function mapOperator(value: string): HubbleFilterOperator {
	const normalized = value.toLowerCase() as HubbleFilterOperator;
	const supported = new Set<HubbleFilterOperator>([
		'contains',
		'eq',
		'gt',
		'gte',
		'in',
		'is_not_null',
		'is_null',
		'lt',
		'lte',
		'ne'
	]);
	if (!supported.has(normalized)) {
		throw new HubbleWarehouseInputError(
			'Unsupported Hubble filter operator: ' + value
		);
	}
	return normalized;
}

function mapGraphqlError(error: unknown): GraphQLError {
	if (error instanceof HubbleWarehouseInputError) {
		return new GraphQLError(error.message, {
			extensions: { code: 'BAD_USER_INPUT' }
		});
	}
	if (error instanceof HubbleWarehouseUnavailableError) {
		console.error('Hubble GraphQL warehouse request failed', error);
		return new GraphQLError('The Hubble warehouse is temporarily unavailable', {
			extensions: { code: 'SERVICE_UNAVAILABLE' }
		});
	}
	console.error('Unexpected Hubble GraphQL failure', error);
	return new GraphQLError('The Hubble query could not be completed', {
		extensions: { code: 'INTERNAL_SERVER_ERROR' }
	});
}
