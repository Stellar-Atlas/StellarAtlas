import Ajv, { type JSONSchemaType } from 'ajv';
import addFormats from 'ajv-formats';
import type { PublicHistoryArchiveRepairPlan } from './archive-repair-types';
import { repairArtifactSchema } from './history-archive-repair-artifact-schema';

type RepairAction = PublicHistoryArchiveRepairPlan['actions'][number];
type RepairCheckpointEvidence = RepairAction['checkpointEvidence'][number];
type RepairObjectEvidence = RepairAction['evidence'][number];
type RepairSource = RepairAction['knownGoodSources'][number];
type RepairInfrastructureBlock =
	PublicHistoryArchiveRepairPlan['infrastructureBlocks'][number];

// Ajv v8 mis-infers required T | null properties; retain the schema type here.
const nullable = <Schema extends object>(schema: Schema): Schema =>
	({ ...schema, nullable: true }) as Schema;

const sourceSchema: JSONSchemaType<RepairSource> = {
	type: 'object',
	properties: {
		archiveUrl: { type: 'string', format: 'uri' },
		archiveUrlIdentity: { type: 'string', minLength: 1 },
		objectUrl: { type: 'string', format: 'uri' },
		proof: {
			type: 'object',
			properties: {
				anchor: {
					type: 'object',
					properties: {
						kind: {
							type: 'string',
							enum: [
								'content-addressed-bucket',
								'multi-source',
								'target-digest'
							]
						},
						sourceCount: { type: 'integer', minimum: 1 }
					},
					required: ['kind', 'sourceCount'],
					additionalProperties: false
				},
				candidateObjectRemoteId: { type: 'string', minLength: 1 },
				checkpointLedger: { type: 'integer', minimum: 0 },
				contentHash: {
					type: 'object',
					properties: {
						algorithm: { type: 'string', enum: ['sha256'] },
						digest: {
							type: 'string',
							pattern: '^[0-9a-f]{64}$'
						},
						representation: {
							type: 'string',
							enum: ['canonical-json', 'uncompressed-xdr']
						}
					},
					required: ['algorithm', 'digest', 'representation'],
					additionalProperties: false
				},
				evaluatedAt: { type: 'string', format: 'date-time' },
				kind: { type: 'string', enum: ['strict-checkpoint'] },
				proofId: { type: 'string', minLength: 1 },
				proofVersion: { type: 'integer', minimum: 1 }
			},
			required: [
				'anchor',
				'candidateObjectRemoteId',
				'checkpointLedger',
				'contentHash',
				'evaluatedAt',
				'kind',
				'proofId',
				'proofVersion'
			],
			additionalProperties: false
		},
		verifiedAt: nullable({ type: 'string', format: 'date-time' })
	},
	required: [
		'archiveUrl',
		'archiveUrlIdentity',
		'objectUrl',
		'proof',
		'verifiedAt'
	],
	additionalProperties: false
};

const objectEvidenceSchema: JSONSchemaType<RepairObjectEvidence> = {
	type: 'object',
	properties: {
		archiveUrl: { type: 'string', format: 'uri' },
		archiveUrlIdentity: { type: 'string', minLength: 1 },
		bucketHash: nullable({ type: 'string', pattern: '^[0-9a-f]{64}$' }),
		checkpointLedger: nullable({ type: 'integer', minimum: 0 }),
		evidenceClass: {
			type: 'string',
			enum: [
				'archive-object',
				'worker-infrastructure',
				'coordinator-infrastructure'
			]
		},
		errorMessage: nullable({ type: 'string' }),
		errorType: nullable({ type: 'string' }),
		failureClass: {
			type: 'string',
			enum: [
				'http',
				'auth',
				'not-found',
				'rate-limit',
				'timeout',
				'transport',
				'worker',
				'coordinator',
				'unknown'
			]
		},
		httpStatus: nullable({ type: 'integer' }),
		nextAttemptAt: nullable({ type: 'string', format: 'date-time' }),
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
		observedCheckpointLedger: nullable({ type: 'integer', minimum: 0 }),
		remoteId: { type: 'string', minLength: 1 },
		status: {
			type: 'string',
			enum: ['pending', 'scanning', 'verified', 'failed']
		},
		updatedAt: { type: 'string', format: 'date-time' }
	},
	required: [
		'archiveUrl',
		'archiveUrlIdentity',
		'bucketHash',
		'checkpointLedger',
		'evidenceClass',
		'errorMessage',
		'errorType',
		'failureClass',
		'httpStatus',
		'nextAttemptAt',
		'objectKey',
		'objectType',
		'objectUrl',
		'observedCheckpointLedger',
		'remoteId',
		'status',
		'updatedAt'
	],
	additionalProperties: false
};

const checkpointEvidenceSchema: JSONSchemaType<RepairCheckpointEvidence> = {
	type: 'object',
	properties: {
		bucketsVerified: { type: 'boolean' },
		checkpointBucketListHash: nullable({
			type: 'string',
			pattern: '^[0-9a-f]{64}$'
		}),
		checkpointBucketListMatches: { type: 'boolean' },
		checkpointLedger: { type: 'integer', minimum: 0 },
		expectedBucketCount: { type: 'integer', minimum: 0 },
		failedBucketCount: { type: 'integer', minimum: 0 },
		failureKind: nullable({ type: 'string' }),
		ledgerBucketListHash: nullable({
			type: 'string',
			pattern: '^[0-9a-f]{64}$'
		}),
		missingBucketCount: { type: 'integer', minimum: 0 },
		previousLedgersMatch: { type: 'boolean' },
		proofFactsComplete: { type: 'boolean' },
		requiredObjectsComplete: { type: 'boolean' },
		resultsMatch: { type: 'boolean' },
		status: {
			type: 'string',
			enum: ['pending', 'verified', 'mismatch', 'not-evaluable']
		},
		transactionFactCount: { type: 'integer', minimum: 0 },
		transactionsMatch: { type: 'boolean' },
		verifiedBucketCount: { type: 'integer', minimum: 0 }
	},
	required: [
		'bucketsVerified',
		'checkpointBucketListHash',
		'checkpointBucketListMatches',
		'checkpointLedger',
		'expectedBucketCount',
		'failedBucketCount',
		'failureKind',
		'ledgerBucketListHash',
		'missingBucketCount',
		'previousLedgersMatch',
		'proofFactsComplete',
		'requiredObjectsComplete',
		'resultsMatch',
		'status',
		'transactionFactCount',
		'transactionsMatch',
		'verifiedBucketCount'
	],
	additionalProperties: false
};

const actionSchema: JSONSchemaType<RepairAction> = {
	type: 'object',
	properties: {
		actionId: { type: 'string', minLength: 1 },
		bucketHash: nullable({ type: 'string', pattern: '^[0-9a-f]{64}$' }),
		checkpointEvidence: {
			type: 'array',
			items: checkpointEvidenceSchema
		},
		checkpointLedger: nullable({ type: 'integer', minimum: 0 }),
		evidence: { type: 'array', items: objectEvidenceSchema },
		kind: {
			type: 'string',
			enum: [
				'restore-history-archive-state',
				'replace-archive-file',
				'replace-bucket-file',
				'repair-checkpoint-proof',
				'wait-for-scanner-proof'
			]
		},
		knownGoodSources: { type: 'array', maxItems: 5, items: sourceSchema },
		reason: {
			type: 'string',
			enum: [
				'access-denied',
				'archive-object-failed',
				'bucket-hash-mismatch',
				'bucket-missing',
				'checkpoint-ledger-mismatch',
				'checkpoint-bucket-list-mismatch',
				'history-archive-state-missing',
				'http-error',
				'missing-object',
				'object-failed',
				'object-incomplete',
				'previous-ledger-hash-mismatch',
				'proof-facts-incomplete',
				'rate-limited',
				'result-hash-mismatch',
				'scanner-infrastructure',
				'transaction-hash-mismatch',
				'transport-error'
			]
		},
		repairArtifact: repairArtifactSchema,
		severity: {
			type: 'string',
			enum: ['error', 'warning', 'blocked']
		},
		summary: { type: 'string' }
	},
	required: [
		'actionId',
		'bucketHash',
		'checkpointEvidence',
		'checkpointLedger',
		'evidence',
		'kind',
		'knownGoodSources',
		'reason',
		'repairArtifact',
		'severity',
		'summary'
	],
	additionalProperties: false
};

const infrastructureBlockSchema: JSONSchemaType<RepairInfrastructureBlock> = {
	type: 'object',
	properties: {
		archiveUrlIdentity: { type: 'string', minLength: 1 },
		blockedUntil: nullable({ type: 'string', format: 'date-time' }),
		evidenceClass: {
			type: 'string',
			enum: [
				'archive-object',
				'worker-infrastructure',
				'coordinator-infrastructure'
			]
		},
		failureClass: {
			type: 'string',
			enum: [
				'http',
				'auth',
				'not-found',
				'rate-limit',
				'timeout',
				'transport',
				'worker',
				'coordinator',
				'unknown'
			]
		},
		hostIdentity: { type: 'string', minLength: 1 },
		httpStatus: nullable({ type: 'integer' }),
		summary: { type: 'string' }
	},
	required: [
		'archiveUrlIdentity',
		'blockedUntil',
		'evidenceClass',
		'failureClass',
		'hostIdentity',
		'httpStatus',
		'summary'
	],
	additionalProperties: false
};

const repairPlanSchema: JSONSchemaType<PublicHistoryArchiveRepairPlan> = {
	$id: 'history-archive-repair-plan-v1.json',
	$schema: 'http://json-schema.org/draft-07/schema#',
	type: 'object',
	properties: {
		actionCount: { type: 'integer', minimum: 0 },
		actions: { type: 'array', maxItems: 500, items: actionSchema },
		archiveUrl: { type: 'string', format: 'uri' },
		archiveUrlIdentity: { type: 'string', minLength: 1 },
		generatedAt: { type: 'string', format: 'date-time' },
		infrastructureBlocks: {
			type: 'array',
			items: infrastructureBlockSchema
		},
		limit: { type: 'integer', minimum: 1, maximum: 500 },
		summary: {
			type: 'object',
			properties: {
				activeObjectChecks: { type: 'integer', minimum: 0 },
				failedCheckpointProofs: { type: 'integer', minimum: 0 },
				failedObjectChecks: { type: 'integer', minimum: 0 },
				pendingObjectChecks: { type: 'integer', minimum: 0 },
				verifiedObjectChecks: { type: 'integer', minimum: 0 }
			},
			required: [
				'activeObjectChecks',
				'failedCheckpointProofs',
				'failedObjectChecks',
				'pendingObjectChecks',
				'verifiedObjectChecks'
			],
			additionalProperties: false
		}
	},
	required: [
		'actionCount',
		'actions',
		'archiveUrl',
		'archiveUrlIdentity',
		'generatedAt',
		'infrastructureBlocks',
		'limit',
		'summary'
	],
	additionalProperties: false
};

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateRepairPlan = ajv.compile(repairPlanSchema);

export function parseHistoryArchiveRepairPlan(
	value: unknown
): PublicHistoryArchiveRepairPlan {
	if (!validateRepairPlan(value)) {
		const details = ajv.errorsText(validateRepairPlan.errors, {
			dataVar: 'response',
			separator: '; '
		});
		throw new Error(
			`Archive repair plan response did not match the v1 contract: ${details}`
		);
	}

	return value;
}
