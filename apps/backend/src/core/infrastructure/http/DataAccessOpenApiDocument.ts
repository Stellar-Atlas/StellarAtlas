import {
	readOpenApiRecord,
	type OpenApiRecord
} from './OpenApiDocumentProjection.js';

export const DATA_ACCESS_HISTORY_DATASETS = [
	'account-state-changes',
	'contract-events',
	'ledger-close-meta',
	'ledger-entry-changes',
	'ledgers',
	'operations',
	'transaction-meta',
	'transaction-results',
	'transactions',
	'trustline-state-changes'
] as const;

const tag = ['Data access'];
const publicAccess: readonly OpenApiRecord[] = [];
const errorResponse = (description: string): OpenApiRecord => ({
	content: {
		'application/json': {
			schema: {
				additionalProperties: false,
				properties: { error: { type: 'string' } },
				required: ['error'],
				type: 'object'
			}
		}
	},
	description
});
const datasetSchema: OpenApiRecord = {
	enum: DATA_ACCESS_HISTORY_DATASETS,
	type: 'string'
};
const batchIdParameter: OpenApiRecord = {
	description: 'Immutable batch UUID returned by the batch-list endpoint.',
	in: 'path',
	name: 'batchId',
	required: true,
	schema: { format: 'uuid', type: 'string' }
};
const datasetPathParameter: OpenApiRecord = {
	description: 'Typed dataset contained in the immutable batch.',
	in: 'path',
	name: 'dataset',
	required: true,
	schema: datasetSchema
};
const artifactHeaders: OpenApiRecord = {
	'Accept-Ranges': {
		description: 'The artifact supports HTTP byte ranges.',
		schema: { example: 'bytes', type: 'string' }
	},
	ETag: {
		description: 'Immutable SHA-256 entity tag.',
		schema: { type: 'string' }
	},
	'X-Content-SHA256': {
		description:
			'Lowercase hexadecimal SHA-256 digest of the complete artifact.',
		schema: { pattern: '^[0-9a-f]{64}$', type: 'string' }
	}
};
const artifactResponse: OpenApiRecord = {
	content: {
		'application/vnd.apache.parquet': {
			schema: { format: 'binary', type: 'string' }
		},
		'application/x-stellar-ledger-close-meta-batch+xdr+zstd': {
			schema: { format: 'binary', type: 'string' }
		}
	},
	description:
		'Immutable history artifact. Range requests may return HTTP 206.',
	headers: artifactHeaders
};

const dataAccessPaths: Readonly<Record<string, OpenApiRecord>> = {
	'/horizon/': {
		get: {
			description:
				'Read-only proxy to the configured public-network Horizon service. Links in JSON responses are rewritten under /horizon. The complete Horizon resource surface is available below this prefix; state-changing methods return 405.',
			externalDocs: {
				description: 'Official Horizon API reference',
				url: 'https://developers.stellar.org/docs/data/apis/horizon/api-reference'
			},
			operationId: 'getHorizonRoot',
			responses: {
				'200': {
					content: {
						'application/hal+json': {
							schema: { additionalProperties: true, type: 'object' }
						},
						'application/json': {
							schema: { additionalProperties: true, type: 'object' }
						}
					},
					description: 'Horizon root resource.'
				},
				'502': errorResponse('The configured Horizon upstream is unavailable.')
			},
			security: publicAccess,
			summary: 'Get the Horizon root resource',
			tags: tag
		}
	},
	'/galexie/.config.json': {
		get: {
			description:
				'Returns the upstream SEP-54 configuration used to derive Galexie LedgerCloseMeta object keys. Other immutable SEP-54 objects are available read-only below /galexie using paths described by this configuration.',
			externalDocs: {
				description: 'SEP-54: Unified Data Ingestion Scheme',
				url: 'https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0054.md'
			},
			operationId: 'getGalexieConfiguration',
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: {
								additionalProperties: true,
								properties: {
									batchesPerPartition: {
										minimum: 1,
										type: 'integer'
									},
									compression: { type: 'string' },
									ledgersPerBatch: {
										minimum: 1,
										type: 'integer'
									},
									networkPassphrase: { type: 'string' },
									version: { type: 'string' }
								},
								type: 'object'
							}
						}
					},
					description: 'SEP-54 source configuration.'
				},
				'502': errorResponse('The configured Galexie upstream is unavailable.')
			},
			security: publicAccess,
			summary: 'Get Galexie SEP-54 configuration',
			tags: tag
		}
	},
	'/v1/history-data/catalog': {
		get: {
			description:
				'Describes the immutable decoded-history collection, its durable contiguous and supplemental coverage, and the exact genesis-to-ledger-2 origin of the LedgerCloseMeta stream.',
			operationId: 'getHistoryDataCatalog',
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: {
								additionalProperties: false,
								properties: {
									batchListPath: { type: 'string' },
									coverage: {
										additionalProperties: true,
										type: 'object'
									},
									format: {
										enum: ['stellar-atlas-decoded-history-v1'],
										type: 'string'
									},
									historyOrigin: {
										anyOf: [
											{
												additionalProperties: false,
												properties: {
													explanation: { type: 'string' },
													firstLedgerCloseMeta: {
														additionalProperties: false,
														properties: {
															hash: {
																pattern: '^[0-9a-f]{64}$',
																type: 'string'
															},
															previousLedgerHash: {
																pattern: '^[0-9a-f]{64}$',
																type: 'string'
															},
															sequence: { enum: ['2'], type: 'string' },
															transactionCount: { enum: [0], type: 'integer' }
														},
														required: [
															'hash',
															'previousLedgerHash',
															'sequence',
															'transactionCount'
														],
														type: 'object'
													},
													genesis: {
														additionalProperties: false,
														properties: {
															hash: {
																pattern: '^[0-9a-f]{64}$',
																type: 'string'
															},
															ledgerCloseMetaAvailable: {
																enum: [false],
																type: 'boolean'
															},
															sequence: { enum: ['1'], type: 'string' }
														},
														required: [
															'hash',
															'ledgerCloseMetaAvailable',
															'sequence'
														],
														type: 'object'
													}
												},
												required: [
													'explanation',
													'firstLedgerCloseMeta',
													'genesis'
												],
												type: 'object'
											},
											{ type: 'null' }
										]
									},
									galexie: {
										additionalProperties: false,
										properties: {
											compatible: { type: 'boolean' },
											endpoint: { type: 'string' },
											explanation: { type: 'string' }
										},
										required: ['compatible', 'endpoint', 'explanation'],
										type: 'object'
									},
									generatedAt: {
										format: 'date-time',
										type: 'string'
									},
									networkPassphrase: { type: 'string' },
									sourceFormat: { type: 'string' },
									storage: { type: 'string' }
								},
								required: [
									'batchListPath',
									'coverage',
									'format',
									'historyOrigin',
									'galexie',
									'generatedAt',
									'networkPassphrase',
									'sourceFormat',
									'storage'
								],
								type: 'object'
							}
						}
					},
					description: 'Decoded-history catalog and coverage.'
				},
				'500': errorResponse('The history-data catalog is unavailable.')
			},
			security: publicAccess,
			summary: 'Get decoded-history catalog',
			tags: tag
		}
	},
	'/v1/history-data/batches': {
		get: {
			description:
				'Lists immutable decoded-history batches in descending ledger order. Use nextBeforeLedger as beforeLedger to continue pagination.',
			operationId: 'listHistoryDataBatches',
			parameters: [
				{
					description: 'Return only this dataset in each selected batch.',
					in: 'query',
					name: 'dataset',
					required: false,
					schema: datasetSchema
				},
				{
					description: 'Maximum batches returned.',
					in: 'query',
					name: 'limit',
					required: false,
					schema: {
						default: 25,
						maximum: 100,
						minimum: 1,
						type: 'integer'
					}
				},
				{
					description:
						'Return batches beginning below this unsigned ledger sequence.',
					in: 'query',
					name: 'beforeLedger',
					required: false,
					schema: {
						maximum: 4_294_967_295,
						minimum: 1,
						type: 'integer'
					}
				}
			],
			responses: {
				'200': {
					content: {
						'application/json': {
							schema: {
								additionalProperties: false,
								properties: {
									batches: {
										items: {
											additionalProperties: false,
											properties: {
												batchId: {
													format: 'uuid',
													type: 'string'
												},
												endLedger: { type: 'string' },
												ledgerCount: {
													minimum: 1,
													type: 'integer'
												},
												outputs: {
													items: {
														additionalProperties: false,
														properties: {
															byteCount: {
																type: 'string'
															},
															dataset: datasetSchema,
															downloadPath: {
																type: 'string'
															},
															mediaType: {
																type: 'string'
															},
															recordCount: {
																type: 'string'
															},
															representation: {
																enum: ['lossless-replay', 'typed-projection'],
																type: 'string'
															},
															schemaVersion: {
																type: 'string'
															},
															sha256: {
																pattern: '^[0-9a-f]{64}$',
																type: 'string'
															}
														},
														required: [
															'byteCount',
															'dataset',
															'downloadPath',
															'mediaType',
															'recordCount',
															'representation',
															'schemaVersion',
															'sha256'
														],
														type: 'object'
													},
													type: 'array'
												},
												processedAt: {
													format: 'date-time',
													type: 'string'
												},
												startLedger: { type: 'string' }
											},
											required: [
												'batchId',
												'endLedger',
												'ledgerCount',
												'outputs',
												'processedAt',
												'startLedger'
											],
											type: 'object'
										},
										type: 'array'
									},
									dataset: {
										anyOf: [datasetSchema, { type: 'null' }]
									},
									generatedAt: {
										format: 'date-time',
										type: 'string'
									},
									limit: { type: 'integer' },
									nextBeforeLedger: {
										anyOf: [{ type: 'string' }, { type: 'null' }]
									}
								},
								required: [
									'batches',
									'dataset',
									'generatedAt',
									'limit',
									'nextBeforeLedger'
								],
								type: 'object'
							}
						}
					},
					description: 'A page of immutable decoded-history batches.'
				},
				'400': errorResponse('One or more query parameters are invalid.'),
				'500': errorResponse('The batch catalog is unavailable.')
			},
			security: publicAccess,
			summary: 'List decoded-history batches',
			tags: tag
		}
	},
	'/v1/history-data/batches/{batchId}/{dataset}': {
		get: {
			description:
				'Downloads one immutable artifact. Send Range to retrieve a byte range; verify the complete content with X-Content-SHA256.',
			operationId: 'downloadHistoryDataBatchArtifact',
			parameters: [batchIdParameter, datasetPathParameter],
			responses: {
				'200': artifactResponse,
				'206': artifactResponse,
				'400': errorResponse('The batch UUID or dataset is invalid.'),
				'404': errorResponse('No matching immutable artifact exists.'),
				'503': errorResponse('The catalogued artifact is unavailable.')
			},
			security: publicAccess,
			summary: 'Download an immutable history artifact',
			tags: tag
		},
		head: {
			description:
				'Returns the same immutable artifact headers without a response body.',
			operationId: 'headHistoryDataBatchArtifact',
			parameters: [batchIdParameter, datasetPathParameter],
			responses: {
				'200': {
					description: 'Immutable artifact headers.',
					headers: artifactHeaders
				},
				'400': errorResponse('The batch UUID or dataset is invalid.'),
				'404': errorResponse('No matching immutable artifact exists.'),
				'503': errorResponse('The catalogued artifact is unavailable.')
			},
			security: publicAccess,
			summary: 'Inspect an immutable history artifact',
			tags: tag
		}
	}
};

export function withDataAccessOpenApiPaths(document: unknown): OpenApiRecord {
	const source = readOpenApiRecord(document);
	if (source === null)
		throw new TypeError('OpenAPI document must be an object');
	const paths = readOpenApiRecord(source.paths);
	if (paths === null) throw new TypeError('OpenAPI paths must be an object');
	for (const path of Object.keys(dataAccessPaths)) {
		if (path in paths) {
			throw new Error('OpenAPI data-access path already exists: ' + path);
		}
	}
	return {
		...source,
		paths: {
			...paths,
			...dataAccessPaths
		}
	};
}
