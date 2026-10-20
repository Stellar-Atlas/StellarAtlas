import type { OpenApiRecord } from './OpenApiDocumentProjection.js';

export const contractProvenancePaths: Record<string, unknown> = {
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
