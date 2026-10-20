import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';

export function datasetResourceOpenApiPaths(
	paths: Readonly<Record<string, OpenApiRecord>>,
	columnSchema: OpenApiRecord
): OpenApiRecord {
	const alias = (
		path: string,
		method: string,
		operationId: string
	): OpenApiRecord => {
		const operation = readOpenApiRecord(paths[path]?.[method]);
		if (!operation) throw new Error('Missing dataset API operation: ' + path);
		return { [method]: { ...operation, operationId } };
	};
	const detail = '/v1/analytics/datasets/{dataset}';
	const source = readOpenApiRecord(paths[detail]?.get);
	if (!source) throw new Error('Missing dataset descriptor operation');
	const responses = readOpenApiRecord(source.responses) ?? {};
	return {
		'/v1/datasets': alias(
			'/v1/analytics/datasets',
			'get',
			'listParsedDatasets'
		),
		'/v1/datasets/{dataset}': alias(detail, 'get', 'getParsedDataset'),
		'/v1/datasets/{dataset}/records': alias(
			'/v1/analytics/{dataset}',
			'get',
			'queryParsedDatasetRecords'
		),
		'/v1/datasets/{dataset}/query': alias(
			detail + '/query',
			'post',
			'queryParsedDataset'
		),
		'/v1/datasets/{dataset}/schema': {
			get: {
				...source,
				operationId: 'getParsedDatasetSchema',
				summary: 'Inspect a parsed dataset schema',
				description:
					'Live column names, storage types and schema source. Uses the shared metadata catalogue; does not scan dataset records.',
				responses: {
					...responses,
					'200': {
						description: 'Dataset columns and schema source.',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									additionalProperties: false,
									required: ['dataset', 'columns', 'officialSchemaSource'],
									properties: {
										dataset: { type: 'string' },
										columns: { type: 'array', items: columnSchema },
										officialSchemaSource: { type: 'string' }
									}
								}
							}
						}
					}
				}
			}
		}
	};
}
