import type { OpenApiRecord } from './OpenApiDocumentProjection.js';
import { readOpenApiRecord } from './OpenApiDocumentProjection.js';
import {
	hubbleCoverageSchema,
	text,
	nullableText,
	object,
	array,
	jsonResponse
} from './HubbleOpenApiSchemas.js';
import {
	hubbleCoverageExample,
	hubbleExampleDescription
} from './HubbleOpenApiExamples.js';

const aggregateFunction = {
	type: 'string',
	enum: ['count', 'count_distinct', 'sum', 'avg', 'min', 'max']
};
const metric = object(
	{
		function: {
			...aggregateFunction,
			description:
				'count accepts an optional field and skips null field values; count_distinct is exact and skips nulls. sum/avg require numeric fields; min/max support scalar columns.'
		},
		field: {
			...text,
			description: 'Catalog column. Required except for count.'
		},
		alias: {
			type: 'string',
			pattern: '^[a-z][a-z0-9_]{0,63}$',
			example: 'operations',
			description: 'Unique output name that does not shadow a source column.'
		}
	},
	['function', 'alias']
);
const ledger = { type: 'integer', minimum: 1, maximum: 2147483647 };
export const hubbleAggregateExample = {
	dataset: 'history_operations',
	minLedger: 63490364,
	maxLedger: 63490364,
	groupBy: ['type_string'],
	aggregations: [{ function: 'count', alias: 'operations' }],
	orderBy: [{ field: 'operations', direction: 'desc' }],
	limit: 20,
	offset: 0
};
const responseExample = {
	columns: ['type_string', 'operations'],
	dataset: 'history_operations',
	elapsedMilliseconds: 8.5,
	limit: 20,
	offset: 0,
	rows: [{ type_string: 'invoke_host_function', operations: '1' }],
	nextOffset: null,
	coverage: hubbleCoverageExample,
	coverageStatus: 'complete',
	window: { minLedger: 63490364, maxLedger: 63490364 },
	aggregates: [
		{
			alias: 'operations',
			function: 'count',
			field: null,
			sourceType: null,
			valueEncoding: 'string-or-null',
			approximate: false
		}
	],
	semantics:
		'Aggregates of completed, digest-matched rows; not reconstructed current state. Pagination is not snapshot-pinned.'
};
const description =
	'Group matching parsed rows and calculate counts, exact distinct counts, sums, averages and extrema. Both minLedger and maxLedger are required and the inclusive range may cover at most 1,000,000 ledgers. At most 8 group columns, 16 metrics and 64 filters. orderBy names group columns or metric aliases; group keys break ties. No arbitrary SQL, joins, windows or current-state reconstruction. A partial coverage result is not a complete-history answer. Group keys and metrics are strings or null; Float sources and averages remain approximate. Empty count=0; empty sum/avg/min/max=null. Follow nextOffset with identical filters; continuing ingestion means pages are not snapshot-pinned.';
export function withHubbleAggregateInput(
	raw: OpenApiRecord,
	requireDataset = true
): OpenApiRecord {
	const properties = readOpenApiRecord(raw.properties)!;
	const rawBranch = { ...raw, required: requireDataset ? ['dataset'] : [] };
	const { select: _select, ...aggregateBase } = properties;
	const aggregateBranch: OpenApiRecord = {
		type: 'object',
		additionalProperties: false,
		description,
		properties: {
			...aggregateBase,
			groupBy: { type: 'array', items: text, maxItems: 8, uniqueItems: true },
			aggregations: { type: 'array', items: metric, minItems: 1, maxItems: 16 },
			minLedger: { ...ledger, example: 63490364 },
			maxLedger: { ...ledger, example: 63490364 },
			limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
			offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
			filters: { ...readOpenApiRecord(properties.filters), maxItems: 64 }
		},
		required: [
			...(requireDataset ? ['dataset'] : []),
			'aggregations',
			'minLedger',
			'maxLedger'
		]
	};
	return {
		oneOf: [rawBranch, aggregateBranch],
		description,
		example: requireDataset
			? raw.example
			: (({ dataset: _dataset, ...value }) => value)(hubbleAggregateExample)
	};
}
export function withHubbleAggregateResult(raw: OpenApiRecord): OpenApiRecord {
	const aggregateResult: OpenApiRecord = {
		...raw,
		description: hubbleExampleDescription + ' ' + description,
		example: responseExample,
		properties: {
			...readOpenApiRecord(raw.properties),
			nextOffset: { type: 'integer', minimum: 0, nullable: true },
			coverage: hubbleCoverageSchema,
			coverageStatus: {
				type: 'string',
				enum: ['complete', 'partial_or_unknown']
			},
			window: object({ minLedger: ledger, maxLedger: ledger }),
			aggregates: array(
				object({
					alias: text,
					function: aggregateFunction,
					field: nullableText,
					sourceType: nullableText,
					valueEncoding: { type: 'string', enum: ['string-or-null'] },
					approximate: { type: 'boolean' }
				})
			),
			semantics: text
		},
		required: [
			...(raw.required as string[]),
			'nextOffset',
			'coverage',
			'coverageStatus',
			'window',
			'aggregates',
			'semantics'
		]
	};
	return {
		oneOf: [raw, aggregateResult],
		description: hubbleExampleDescription,
		example: responseExample
	};
}
export function hubbleDatasetQueryPaths(
	raw: OpenApiRecord,
	result: OpenApiRecord
): OpenApiRecord {
	return {
		'/v1/analytics/datasets/{dataset}/query': {
			post: {
				operationId: 'queryHubbleDataset',
				tags: ['Analytics'],
				security: [],
				summary: 'Filter or aggregate one parsed dataset',
				description,
				parameters: [
					{
						in: 'path',
						name: 'dataset',
						required: true,
						schema: { type: 'string', example: 'history_operations' },
						description:
							'Dataset from /v1/analytics/datasets. If supplied in the body it must match this path.'
					}
				],
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: withHubbleAggregateInput(raw, false),
							examples: {
								operationCounts: {
									summary: 'Operations by type in one ledger',
									value: (({ dataset: _dataset, ...value }) => value)(
										hubbleAggregateExample
									)
								}
							}
						}
					}
				},
				responses: {
					'200': jsonResponse(
						withHubbleAggregateResult(result),
						'Matching rows or aggregates, with coverage and precision metadata for aggregates.'
					),
					'400': jsonResponse(
						object({ code: text, error: text }),
						'Invalid columns, range, aggregation, filters or path/body mismatch.'
					),
					'503': jsonResponse(
						object({ code: text, error: text }),
						'Warehouse unavailable; no successful empty result is substituted.'
					)
				}
			}
		}
	};
}
