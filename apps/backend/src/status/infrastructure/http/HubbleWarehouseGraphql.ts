import type { RequestHandler } from 'express';
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

const schema = buildSchema(`
	scalar JSON

	type Query {
		hubbleStatus: HubbleStatus!
		hubbleDatasets: [HubbleDataset!]!
		hubbleQuery(input: HubbleQueryInput!): HubbleQueryResult!
	}

	type HubbleStatus {
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
	}

	input HubbleQueryInput {
		dataset: String!
		filters: [HubbleFilterInput!]
		limit: Int
		offset: Float
		orderBy: [HubbleOrderInput!]
		select: [String!]
	}

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
`);

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
	};
}

export function hubbleWarehouseGraphqlHandler(
	warehouse: HubbleWarehouse
): RequestHandler {
	return createHandler({
		schema,
		rootValue: {
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
						availableQueries: ['hubbleDatasets', 'hubbleQuery'],
						compatibility: 'official-stellar-etl-schema',
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
		select: input.select
	};
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
