import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';
import { hubbleSemanticPaths } from './HubbleSemanticOpenApiPaths.js';

const analyticsTag = ['Analytics'];
const publicAccess: readonly OpenApiRecord[] = [];
const datasetParameter: OpenApiRecord = {
	description:
		'Official Stellar ETL/Hubble table name returned by the dataset catalog.',
	in: 'path',
	name: 'dataset',
	required: true,
	schema: {
		example: 'history_transactions',
		pattern: '^[a-z][a-z0-9_]*$',
		type: 'string'
	}
};
const errorResponse = (description: string): OpenApiRecord => ({
	content: {
		'application/json': {
			schema: {
				additionalProperties: false,
				properties: {
					code: { type: 'string' },
					error: { type: 'string' }
				},
				required: ['code', 'error'],
				type: 'object'
			}
		}
	},
	description
});
const columnSchema: OpenApiRecord = {
	additionalProperties: false,
	properties: {
		name: { type: 'string' },
		position: { minimum: 1, type: 'integer' },
		type: { type: 'string' }
	},
	required: ['name', 'position', 'type'],
	type: 'object'
};
const datasetSchema: OpenApiRecord = {
	additionalProperties: false,
	properties: {
		columns: { items: columnSchema, type: 'array' },
		name: { type: 'string' },
		rowCount: {
			description: 'Estimated active ClickHouse rows.',
			pattern: '^[0-9]+$',
			type: 'string'
		}
	},
	required: ['columns', 'name', 'rowCount'],
	type: 'object'
};
const queryResultSchema: OpenApiRecord = {
	additionalProperties: false,
	properties: {
		columns: { items: { type: 'string' }, type: 'array' },
		dataset: { type: 'string' },
		elapsedMilliseconds: { minimum: 0, type: 'number' },
		limit: { minimum: 1, type: 'integer' },
		offset: { minimum: 0, type: 'integer' },
		rows: {
			items: {
				additionalProperties: true,
				type: 'object'
			},
			type: 'array'
		}
	},
	required: [
		'columns',
		'dataset',
		'elapsedMilliseconds',
		'limit',
		'offset',
		'rows'
	],
	type: 'object'
};
const queryBodySchema: OpenApiRecord = {
	additionalProperties: false,
	properties: {
		dataset: { type: 'string' },
		filters: {
			items: {
				additionalProperties: false,
				properties: {
					field: { type: 'string' },
					operator: {
						default: 'eq',
						enum: [
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
						],
						type: 'string'
					},
					value: {},
					values: { items: {}, maxItems: 1000, minItems: 1, type: 'array' }
				},
				required: ['field'],
				type: 'object'
			},
			type: 'array'
		},
		limit: { default: 100, maximum: 1000, minimum: 1, type: 'integer' },
		offset: { default: 0, minimum: 0, type: 'integer' },
		orderBy: {
			items: {
				additionalProperties: false,
				properties: {
					direction: {
						default: 'asc',
						enum: ['asc', 'desc'],
						type: 'string'
					},
					field: { type: 'string' }
				},
				required: ['field'],
				type: 'object'
			},
			type: 'array'
		},
		select: { items: { type: 'string' }, type: 'array' }
	},
	required: ['dataset'],
	type: 'object'
};

const hubblePaths: Readonly<Record<string, OpenApiRecord>> = {
	...hubbleSemanticPaths,
	'/v1/analytics/datasets': {
		get: {
			description:
				'Lists all 20 official Stellar ETL/Hubble tables, their live ClickHouse columns, row estimates, and immutable-batch ingestion coverage.',
			operationId: 'listHubbleDatasets',
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: {
								additionalProperties: false,
								properties: {
									database: { type: 'string' },
									datasets: {
										items: datasetSchema,
										type: 'array'
									},
									generatedAt: {
										format: 'date-time',
										type: 'string'
									},
									ingestion: {
										additionalProperties: false,
										type: 'object'
									},
									officialSchemaSource: { type: 'string' }
								},
								required: [
									'database',
									'datasets',
									'generatedAt',
									'ingestion',
									'officialSchemaSource'
								],
								type: 'object'
							}
						}
					},
					description: 'Live Hubble warehouse catalog.'
				},
				'503': errorResponse('The Hubble warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'List Hubble datasets',
			tags: analyticsTag
		}
	},
	'/v1/analytics/datasets/{dataset}': {
		get: {
			description:
				'Returns one Hubble table schema and current immutable-batch coverage.',
			operationId: 'getHubbleDataset',
			parameters: [datasetParameter],
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: datasetSchema
						}
					},
					description: 'Hubble dataset schema and coverage.'
				},
				'400': errorResponse('The Hubble dataset is unknown.'),
				'503': errorResponse('The Hubble warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Get a Hubble dataset schema',
			tags: analyticsTag
		}
	},
	'/v1/analytics/{dataset}': {
		get: {
			description:
				'Queries one Hubble table. Any column may be a query parameter. Append __eq, __ne, __gt, __gte, __lt, __lte, __in, __contains, __is_null, or __is_not_null to select an operator. Use select for comma-separated columns and order with a minus prefix for descending order.',
			operationId: 'queryHubbleDatasetResource',
			parameters: [
				datasetParameter,
				{
					description: 'Comma-separated response columns.',
					in: 'query',
					name: 'select',
					required: false,
					schema: { type: 'string' }
				},
				{
					description:
						'Comma-separated order columns; prefix a column with - for descending.',
					in: 'query',
					name: 'order',
					required: false,
					schema: { type: 'string' }
				},
				{
					in: 'query',
					name: 'limit',
					required: false,
					schema: {
						default: 100,
						maximum: 1000,
						minimum: 1,
						type: 'integer'
					}
				},
				{
					in: 'query',
					name: 'offset',
					required: false,
					schema: { default: 0, minimum: 0, type: 'integer' }
				}
			],
			responses: {
				'200': {
					content: {
						'application/json': { schema: queryResultSchema }
					},
					description: 'Filtered Hubble rows.'
				},
				'400': errorResponse('The Hubble query is invalid.'),
				'503': errorResponse('The Hubble warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Query a Hubble dataset',
			tags: analyticsTag
		}
	},
	'/v1/analytics/query': {
		post: {
			description:
				'Runs a structured, parameterized query against any official Hubble table. Raw SQL is not accepted.',
			operationId: 'queryHubbleWarehouse',
			requestBody: {
				content: {
					'application/json': { schema: queryBodySchema }
				},
				required: true
			},
			responses: {
				'200': {
					content: {
						'application/json': { schema: queryResultSchema }
					},
					description: 'Filtered Hubble rows.'
				},
				'400': errorResponse('The Hubble query is invalid.'),
				'503': errorResponse('The Hubble warehouse is unavailable.')
			},
			security: publicAccess,
			summary: 'Run a structured Hubble query',
			tags: analyticsTag
		}
	}
};

export function withHubbleOpenApiPaths(document: unknown): OpenApiRecord {
	const source = readOpenApiRecord(document);
	if (source === null) {
		throw new TypeError('OpenAPI document must be an object');
	}
	const paths = readOpenApiRecord(source.paths);
	if (paths === null) throw new TypeError('OpenAPI paths must be an object');
	for (const path of Object.keys(hubblePaths)) {
		if (path in paths) {
			throw new Error('OpenAPI Hubble path already exists: ' + path);
		}
	}
	return {
		...source,
		paths: {
			...paths,
			...hubblePaths
		}
	};
}
