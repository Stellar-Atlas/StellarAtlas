import type { JSONSchemaType } from 'ajv';
import type { PublicHistoryArchiveRepairPlan } from './archive-repair-types';
import { repairManifestArtifactSchema } from './history-archive-repair-artifact-schema';

type RepairAction = PublicHistoryArchiveRepairPlan['actions'][number];
type RepairManifest = NonNullable<RepairAction['repairManifest']>;
type RepairObjectEvidence = RepairAction['evidence'][number];
type RepairSource = RepairAction['knownGoodSources'][number];

interface RepairManifestSchemaDependencies {
	objectEvidenceSchema: JSONSchemaType<RepairObjectEvidence>;
	sourceSchema: JSONSchemaType<RepairSource>;
}

const nullable = <Schema extends object>(schema: Schema): Schema =>
	({ ...schema, nullable: true }) as Schema;

const manifestStepSchema = {
	oneOf: [
		{
			type: 'object',
			properties: {
				backupSuffix: { type: 'string', minLength: 1 },
				kind: { type: 'string', enum: ['backup-current-file'] },
				order: { type: 'integer', enum: [1] },
				required: { type: 'boolean' }
			},
			required: ['backupSuffix', 'kind', 'order', 'required'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				input: { type: 'string', enum: ['replacement-download-url'] },
				kind: { type: 'string', enum: ['stage-replacement'] },
				order: { type: 'integer', enum: [2] },
				required: { type: 'boolean', enum: [true] },
				stagingLocation: {
					type: 'string',
					enum: ['same-filesystem-temporary-file']
				}
			},
			required: ['input', 'kind', 'order', 'required', 'stagingLocation'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				expectedContentHash: {
					type: 'object',
					properties: {
						algorithm: { type: 'string', enum: ['sha256'] },
						digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
						representation: {
							type: 'string',
							enum: ['canonical-json', 'uncompressed-xdr']
						}
					},
					required: ['algorithm', 'digest', 'representation'],
					additionalProperties: false
				},
				kind: { type: 'string', enum: ['verify-staged-content'] },
				order: { type: 'integer', enum: [3] },
				required: { type: 'boolean', enum: [true] }
			},
			required: ['expectedContentHash', 'kind', 'order', 'required'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['preserve-metadata'] },
				order: { type: 'integer', enum: [4] },
				preserve: {
					type: 'array',
					items: { type: 'string', enum: ['owner', 'mode', 'acl'] },
					minItems: 3,
					maxItems: 3
				},
				required: { type: 'boolean', enum: [true] }
			},
			required: ['kind', 'order', 'preserve', 'required'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['atomic-replace'] },
				order: { type: 'integer', enum: [5] },
				required: { type: 'boolean', enum: [true] },
				requiresSameFilesystem: { type: 'boolean', enum: [true] }
			},
			required: ['kind', 'order', 'required', 'requiresSameFilesystem'],
			additionalProperties: false
		},
		{
			type: 'object',
			properties: {
				kind: { type: 'string', enum: ['request-recheck'] },
				order: { type: 'integer', enum: [6] },
				required: { type: 'boolean', enum: [true] },
				resolutionCondition: {
					type: 'string',
					enum: ['same-object-verified-after-original-evidence']
				}
			},
			required: ['kind', 'order', 'required', 'resolutionCondition'],
			additionalProperties: false
		}
	]
} as const;

export function createRepairManifestSchema({
	objectEvidenceSchema,
	sourceSchema
}: RepairManifestSchemaDependencies) {
	const manifestObjectSchema = {
		type: 'object',
		properties: {
			actionId: { type: 'string', minLength: 1 },
			evidence: objectEvidenceSchema,
			generatedAt: { type: 'string', format: 'date-time' },
			recheck: {
				type: 'object',
				properties: {
					endpoint: {
						type: 'string',
						pattern:
							'^/v1/archive-scans/objects/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/recheck$'
					},
					minimumEvidenceUpdatedAt: { type: 'string', format: 'date-time' },
					resolutionCondition: {
						type: 'string',
						enum: ['same-object-verified-after-original-evidence']
					},
					targetRemoteId: {
						type: 'string',
						pattern:
							'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
					}
				},
				required: [
					'endpoint',
					'minimumEvidenceUpdatedAt',
					'resolutionCondition',
					'targetRemoteId'
				],
				additionalProperties: false
			},
			replacement: {
				oneOf: [
					{
						type: 'object',
						properties: {
							artifact: repairManifestArtifactSchema,
							source: sourceSchema
						},
						required: ['artifact', 'source'],
						additionalProperties: false
					},
					{ type: 'null', nullable: true }
				]
			},
			schemaVersion: { type: 'integer', enum: [1] },
			status: {
				type: 'string',
				enum: ['ready', 'awaiting-verified-replacement']
			},
			steps: { type: 'array', maxItems: 6, items: manifestStepSchema },
			target: {
				type: 'object',
				properties: {
					archiveUrl: { type: 'string', format: 'uri' },
					archiveUrlIdentity: { type: 'string', minLength: 1 },
					bucketHash: nullable({
						type: 'string',
						pattern: '^[0-9a-f]{64}$'
					}),
					checkpointLedger: nullable({ type: 'integer', minimum: 0 }),
					objectKey: { type: 'string', minLength: 1 },
					objectType: {
						type: 'string',
						enum: [
							'history-archive-state',
							'checkpoint-state',
							'ledger',
							'transactions',
							'results',
							'scp',
							'bucket'
						]
					},
					objectUrl: { type: 'string', format: 'uri' },
					operatorTargetPathRequired: { type: 'boolean', enum: [true] }
				},
				required: [
					'archiveUrl',
					'archiveUrlIdentity',
					'bucketHash',
					'checkpointLedger',
					'objectKey',
					'objectType',
					'objectUrl',
					'operatorTargetPathRequired'
				],
				additionalProperties: false
			}
		},
		required: [
			'actionId',
			'evidence',
			'generatedAt',
			'recheck',
			'replacement',
			'schemaVersion',
			'status',
			'steps',
			'target'
		],
		allOf: [
			{
				if: { properties: { status: { const: 'ready' } } },
				then: {
					properties: {
						replacement: { type: 'object' },
						steps: { type: 'array', minItems: 6, maxItems: 6 }
					}
				}
			},
			{
				if: {
					properties: {
						status: { const: 'awaiting-verified-replacement' }
					}
				},
				then: {
					properties: {
						replacement: { type: 'null' },
						steps: { type: 'array', maxItems: 0 }
					}
				}
			}
		],
		additionalProperties: false
	} as unknown as JSONSchemaType<RepairManifest>;

	return {
		oneOf: [manifestObjectSchema, { type: 'null', nullable: true }]
	} as const;
}
