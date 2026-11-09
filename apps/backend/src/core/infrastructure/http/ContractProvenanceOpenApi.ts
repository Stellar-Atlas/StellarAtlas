import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

const catalogueHeaders = {
	'Cache-Control': { schema: { type: 'string', enum: ['no-store'] } }
};

const catalogueCursor = {
	type: 'string',
	minLength: 1,
	maxLength: 512,
	pattern: '^[A-Za-z0-9_-]+$'
};

function catalogueError(code: string, description: string): OpenApiRecord {
	return {
		description,
		headers: catalogueHeaders,
		content: {
			'application/json': {
				schema: {
					type: 'object',
					required: ['code'],
					properties: { code: { type: 'string', enum: [code] } }
				}
			}
		}
	};
}

export const contractProvenancePaths: Record<string, unknown> = {
	'/v1/contracts/catalogue': {
		get: {
			operationId: 'listContractCatalogue',
			tags: ['Contracts'],
			security: [],
			summary: 'Browse stored contract build observations',
			description:
				'Lists the latest stored, accepted build-attestation observation per contract on the configured network. Each record ties signed build evidence to the observed Wasm and ledger. Results may lag the current network head. Independent source reproduction and security audits remain unassessed. Unfiltered and exact-address results are ordered by contract ID. Repository-prefix results are ordered by lowercase repository, then contract ID, using ASCII order. Pages reflect observations stored when each page is read.',
			parameters: [
				{
					name: 'q',
					in: 'query',
					description:
						'Printable ASCII, trimmed before matching. Omit or leave empty to browse. A checksum-valid Stellar C-address selects one contract. Otherwise, search by case-insensitive GitHub owner or owner/repository prefix. The owner is 1–39 ASCII letters, digits or hyphens and begins with a letter or digit. After an optional slash, use up to 100 ASCII letters, digits, dots, underscores or hyphens.',
					schema: { type: 'string', maxLength: 140, pattern: '^[ -~]*$' }
				},
				{
					name: 'limit',
					in: 'query',
					description: 'Maximum number of observations to return.',
					schema: { type: 'integer', minimum: 1, maximum: 50, default: 25 }
				},
				{
					name: 'cursor',
					in: 'query',
					description:
						'Opaque base64url continuation token bound to the configured network and normalized q. Send the same q with nextCursor to continue. Restart without a cursor when the filter changes or the cursor is invalid. Exact-address lookups do not accept a cursor.',
					schema: catalogueCursor
				}
			],
			responses: {
				'200': {
					description: 'A page of stored build-attestation observations.',
					headers: catalogueHeaders,
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ContractCataloguePage' }
						}
					}
				},
				'400': catalogueError(
					'invalid_contract_catalogue_query',
					'Unknown, repeated or malformed query parameter, or an invalid cursor for this filter or network.'
				),
				'503': catalogueError(
					'contract_catalogue_unavailable',
					'The catalogue is disabled, busy or unavailable.'
				)
			}
		}
	},
	'/v1/contracts/{contractId}/provenance': {
		get: {
			operationId: 'getContractBuildProvenance',
			tags: ['Contracts'],
			security: [],
			summary: 'Inspect observed contract build provenance',
			description:
				'Reads the deployed contract executable and associated build attestation at the RPC-observed ledger. The observed ledger is not a promise that the response reflects the current network head. A verified build signature is not a security audit or a claim of reproducible builds; securityAudit remains not_assessed.',
			parameters: [
				{
					name: 'contractId',
					in: 'path',
					required: true,
					description: 'Soroban contract C-address.',
					schema: { type: 'string', pattern: '^C[A-Z2-7]{55}$' }
				}
			],
			responses: {
				'200': {
					description:
						'Contract evidence observed at the reported RPC ledger. Build signature verification does not constitute a security audit or establish reproducible builds.',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/ContractProvenance' }
						}
					}
				},
				'400': {
					description: 'The supplied contractId is not a valid C-address.',
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['code', 'error'],
								properties: {
									code: { type: 'string', enum: ['invalid_contract'] },
									error: { type: 'string' }
								}
							}
						}
					}
				},
				'503': {
					description:
						'Contract evidence is unavailable or build verification is busy. Retry after the indicated delay.',
					headers: {
						'Retry-After': {
							description: 'Seconds to wait before retrying.',
							schema: { type: 'integer', minimum: 0 },
							example: 30
						}
					},
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['code', 'error'],
								properties: {
									code: {
										type: 'string',
										enum: ['contract_evidence_unavailable', 'verification_busy']
									},
									error: { type: 'string' }
								}
							}
						}
					}
				}
			}
		}
	}
} satisfies OpenApiRecord;

export const contractProvenanceSchemas: Record<string, unknown> = {
	ContractProvenance: {
		type: 'object',
		required: [
			'contractId',
			'networkPassphrase',
			'observedLedger',
			'instanceModifiedLedger',
			'checkedAt',
			'executable',
			'wasmSha256',
			'metadata',
			'build',
			'securityAudit'
		],
		properties: {
			contractId: {
				type: 'string',
				pattern: '^C[A-Z2-7]{55}$',
				description: 'Soroban contract C-address.'
			},
			networkPassphrase: { type: 'string' },
			observedLedger: {
				type: 'integer',
				minimum: 0,
				description: 'Ledger at which the contract executable was observed.'
			},
			instanceModifiedLedger: { type: 'integer', nullable: true, minimum: 0 },
			checkedAt: { type: 'string', format: 'date-time' },
			executable: {
				type: 'string',
				enum: ['wasm', 'stellar_asset', 'not_found']
			},
			wasmSha256: {
				type: 'string',
				nullable: true,
				pattern: '^[a-f0-9]{64}$'
			},
			metadata: { $ref: '#/components/schemas/ContractProvenanceMetadata' },
			build: { $ref: '#/components/schemas/ContractProvenanceBuild' },
			securityAudit: {
				type: 'string',
				enum: ['not_assessed'],
				description:
					'No security audit assessment is represented by this endpoint.'
			}
		}
	},
	ContractProvenanceMetadata: {
		type: 'object',
		required: ['sourceRepository', 'homeDomain'],
		properties: {
			sourceRepository: { type: 'string', nullable: true },
			homeDomain: { type: 'string', nullable: true }
		}
	},
	ContractProvenanceBuild: {
		type: 'object',
		required: ['status', 'record'],
		properties: {
			status: {
				type: 'string',
				enum: [
					'verified',
					'not_published',
					'metadata_missing',
					'metadata_invalid',
					'unsupported',
					'invalid',
					'unavailable',
					'builtin',
					'not_found_at_ledger'
				]
			},
			record: {
				type: 'object',
				nullable: true,
				required: [
					'repository',
					'commit',
					'sourceUrl',
					'workflowUrl',
					'runUrl',
					'attestationUrl'
				],
				properties: {
					repository: { type: 'string' },
					commit: { type: 'string', pattern: '^[a-f0-9]{40}$' },
					sourceUrl: { type: 'string', format: 'uri' },
					workflowUrl: { type: 'string', format: 'uri' },
					runUrl: { type: 'string', format: 'uri', nullable: true },
					attestationUrl: { type: 'string', format: 'uri' }
				}
			}
		}
	},
	ContractCataloguePage: {
		type: 'object',
		required: ['version', 'networkPassphrase', 'items', 'nextCursor'],
		properties: {
			version: { type: 'integer', enum: [1] },
			networkPassphrase: { type: 'string' },
			items: {
				type: 'array',
				maxItems: 50,
				items: { $ref: '#/components/schemas/ContractCatalogueItem' }
			},
			nextCursor: {
				...catalogueCursor,
				nullable: true,
				description: 'Opaque continuation token, or null when there is no next page.'
			}
		}
	},
	ContractCatalogueItem: {
		type: 'object',
		required: [
			'contractId',
			'observedLedger',
			'instanceModifiedLedger',
			'checkedAt',
			'wasmSha256',
			'ledgerEvidence',
			'build',
			'independentReproduction',
			'securityAudit'
		],
		properties: {
			contractId: {
				type: 'string',
				pattern: '^C[A-Z2-7]{55}$',
				description: 'Checksum-valid Stellar C-address.'
			},
			observedLedger: { type: 'integer', minimum: 1, maximum: 4294967295 },
			instanceModifiedLedger: {
				type: 'integer',
				nullable: true,
				minimum: 1,
				maximum: 4294967295
			},
			checkedAt: { type: 'string', format: 'date-time', description: 'UTC observation time.' },
			wasmSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
			ledgerEvidence: { type: 'string', enum: ['configured_rpc_observation'] },
			build: {
				type: 'object',
				required: ['status', 'record'],
				properties: {
					status: { type: 'string', enum: ['verified'] },
					record: { $ref: '#/components/schemas/ContractBuildRecord' }
				}
			},
			independentReproduction: { type: 'string', enum: ['not_assessed'] },
			securityAudit: { type: 'string', enum: ['not_assessed'] }
		}
	},
	ContractBuildRecord: {
		type: 'object',
		required: [
			'repository',
			'commit',
			'sourceUrl',
			'workflowUrl',
			'runUrl',
			'attestationUrl'
		],
		properties: {
			repository: { type: 'string' },
			commit: { type: 'string', pattern: '^[a-f0-9]{40}$' },
			sourceUrl: { type: 'string', format: 'uri' },
			workflowUrl: { type: 'string', format: 'uri' },
			runUrl: { type: 'string', format: 'uri', nullable: true },
			attestationUrl: { type: 'string', format: 'uri' }
		}
	}
} satisfies OpenApiRecord;
