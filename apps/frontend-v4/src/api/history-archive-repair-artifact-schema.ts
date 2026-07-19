import type { JSONSchemaType } from 'ajv';
import type { PublicHistoryArchiveRepairPlan } from './archive-repair-types';

type RepairAction = PublicHistoryArchiveRepairPlan['actions'][number];
type RepairArtifact = NonNullable<RepairAction['repairArtifact']>;
type RepairArtifactAvailable = Extract<RepairArtifact, { status: 'available' }>;
type RepairArtifactVerifyOnDownload = Extract<
	RepairArtifact,
	{ status: 'verify-on-download' }
>;
type RepairArtifactUnavailable = Extract<
	RepairArtifact,
	{ status: 'unavailable' }
>;

// Ajv v8 mis-infers required T | null properties; retain the schema type here.
const nullable = <Schema extends object>(schema: Schema): Schema =>
	({ ...schema, nullable: true }) as Schema;

const xdrContentHashSchema: JSONSchemaType<
	RepairArtifactAvailable['contentHash']
> = {
	type: 'object',
	properties: {
		algorithm: { type: 'string', enum: ['sha256'] },
		digest: { type: 'string', pattern: '^[0-9a-f]{64}$' },
		representation: { type: 'string', enum: ['uncompressed-xdr'] }
	},
	required: ['algorithm', 'digest', 'representation'],
	additionalProperties: false
};

const artifactContentHashSchema: JSONSchemaType<
	RepairArtifactVerifyOnDownload['contentHash']
> = {
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
};

const artifactAvailableSchema: JSONSchemaType<RepairArtifactAvailable> = {
	type: 'object',
	properties: {
		artifactType: { type: 'string', enum: ['bucket'] },
		byteLength: { type: 'integer', minimum: 1 },
		contentHash: xdrContentHashSchema,
		downloadUrl: {
			type: 'string',
			pattern: '^/v1/archive-scans/repair-artifacts/buckets/[0-9a-f]{64}$'
		},
		mediaType: { type: 'string', enum: ['application/gzip'] },
		objectIdentity: {
			type: 'string',
			pattern: '^bucket:[0-9a-f]{64}$'
		},
		provenAt: { type: 'string', format: 'date-time' },
		status: { type: 'string', enum: ['available'] }
	},
	required: [
		'artifactType',
		'byteLength',
		'contentHash',
		'downloadUrl',
		'mediaType',
		'objectIdentity',
		'provenAt',
		'status'
	],
	additionalProperties: false
};

const proofBoundObjectPath =
	'^/v1/archive-scans/repair-artifacts/objects/' +
	'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' +
	'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' +
	'[1-9][0-9]*/[1-9][0-9]*/[1-9][0-9]*/[0-9a-f]{64}$';

const artifactVerifyOnDownloadSchema: JSONSchemaType<RepairArtifactVerifyOnDownload> =
	{
		type: 'object',
		properties: {
			artifactType: {
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
			byteLength: nullable({ type: 'integer', minimum: 1 }),
			contentHash: artifactContentHashSchema,
			downloadUrl: {
				type: 'string',
				oneOf: [
					{
						pattern: '^/v1/archive-scans/repair-artifacts/buckets/[0-9a-f]{64}$'
					},
					{ pattern: proofBoundObjectPath }
				]
			},
			mediaType: {
				type: 'string',
				enum: ['application/gzip', 'application/json']
			},
			objectIdentity: { type: 'string', minLength: 1, maxLength: 512 },
			provenAt: { type: 'string', format: 'date-time' },
			status: { type: 'string', enum: ['verify-on-download'] }
		},
		required: [
			'artifactType',
			'byteLength',
			'contentHash',
			'downloadUrl',
			'mediaType',
			'objectIdentity',
			'provenAt',
			'status'
		],
		additionalProperties: false
	};

const artifactUnavailableSchema: JSONSchemaType<RepairArtifactUnavailable> = {
	type: 'object',
	properties: {
		artifactType: { type: 'string', enum: ['bucket'] },
		contentHash: nullable(xdrContentHashSchema),
		objectIdentity: nullable({
			type: 'string',
			pattern: '^bucket:[0-9a-f]{64}$'
		}),
		reason: {
			type: 'string',
			enum: [
				'content-hash-mismatch',
				'invalid-compressed-payload',
				'invalid-object-identity',
				'local-payload-missing',
				'local-payload-not-regular',
				'local-payload-too-large',
				'local-storage-unavailable',
				'verification-busy',
				'verification-deferred',
				'verification-timeout'
			]
		},
		retry: {
			type: 'object',
			properties: {
				afterSeconds: nullable({ type: 'integer', minimum: 1 }),
				retryable: { type: 'boolean' }
			},
			required: ['afterSeconds', 'retryable'],
			additionalProperties: false
		},
		status: { type: 'string', enum: ['unavailable'] }
	},
	required: [
		'artifactType',
		'contentHash',
		'objectIdentity',
		'reason',
		'retry',
		'status'
	],
	additionalProperties: false
};

export const repairArtifactSchema = {
	oneOf: [
		artifactAvailableSchema,
		artifactVerifyOnDownloadSchema,
		artifactUnavailableSchema,
		{ type: 'null', nullable: true }
	]
} as const;
