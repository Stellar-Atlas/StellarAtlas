import { JSONSchemaType } from 'ajv';
import { HistoryArchiveObjectV1Schema } from './history-archive-object-v1.js';
import { HistoryArchiveStateSnapshotV1Schema } from './history-archive-state-v1.js';
import { nullable } from './helper/nullable.js';
import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';
import {
	HistoryArchiveObjectEventPageV1Schema,
	HistoryArchiveObjectPageV1Schema
} from './history-archive-evidence-page-v1.js';
import type {
	KnownArchiveCheckpointCountsV1,
	KnownArchiveEvidenceTotalsV1,
	KnownArchiveFailureFiltersV1,
	KnownArchiveObjectCountsV1,
	KnownArchiveRemoteFailurePageV1,
	KnownArchiveRemoteFailureV1,
	KnownArchiveRootEvidenceV1,
	KnownArchiveVerifiedCopySetV1,
	KnownArchiveVerifiedCopyV1,
	KnownArchiveWorkerIssuePageV1,
	KnownArchiveWorkerIssueV1,
	KnownNodeArchiveEvidenceV1,
	KnownOrganizationArchiveEvidenceV1
} from './known-archive-evidence-v1.js';

const KnownArchiveObjectCountsV1Schema: JSONSchemaType<KnownArchiveObjectCountsV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			bucketObjects: { type: 'number' },
			pendingObjects: { type: 'number' },
			remoteFailureObjects: { type: 'number' },
			totalObjects: { type: 'number' },
			verifiedBucketObjects: { type: 'number' },
			verifiedObjects: { type: 'number' },
			workerIssueObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'bucketObjects',
			'pendingObjects',
			'remoteFailureObjects',
			'totalObjects',
			'verifiedBucketObjects',
			'verifiedObjects',
			'workerIssueObjects'
		],
		additionalProperties: false
	};

const KnownArchiveCheckpointCountsV1Schema: JSONSchemaType<KnownArchiveCheckpointCountsV1> =
	{
		type: 'object',
		properties: {
			mismatchedCheckpoints: { type: 'number' },
			notEvaluableCheckpoints: { type: 'number' },
			pendingCheckpoints: { type: 'number' },
			totalCheckpoints: { type: 'number' },
			verifiedCheckpoints: { type: 'number' }
		},
		required: [
			'mismatchedCheckpoints',
			'notEvaluableCheckpoints',
			'pendingCheckpoints',
			'totalCheckpoints',
			'verifiedCheckpoints'
		],
		additionalProperties: false
	};

export const KnownArchiveRootEvidenceV1Schema: JSONSchemaType<KnownArchiveRootEvidenceV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			checkpoints: KnownArchiveCheckpointCountsV1Schema,
			latestObjectAt: nullable({ type: 'string', format: 'date-time' }),
			nodePublicKeys: { type: 'array', items: { type: 'string' } },
			objects: KnownArchiveObjectCountsV1Schema,
			scannerOwnedState: nullable(HistoryArchiveStateSnapshotV1Schema)
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'checkpoints',
			'latestObjectAt',
			'nodePublicKeys',
			'objects',
			'scannerOwnedState'
		],
		additionalProperties: false
	};

const KnownArchiveVerifiedCopyV1Schema: JSONSchemaType<KnownArchiveVerifiedCopyV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			objectUrl: {
				type: 'string',
				format: 'uri',
				maxLength: 2_048,
				pattern: '^https?://'
			},
			remoteId: { type: 'string' },
			verifiedAt: nullable({ type: 'string', format: 'date-time' })
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'objectUrl',
			'remoteId',
			'verifiedAt'
		],
		additionalProperties: false
	};

const KnownArchiveVerifiedCopySetV1Schema: JSONSchemaType<KnownArchiveVerifiedCopySetV1> =
	{
		type: 'object',
		properties: {
			copies: { type: 'array', items: KnownArchiveVerifiedCopyV1Schema },
			count: { type: 'number' },
			sampleLimit: { type: 'number' }
		},
		required: ['copies', 'count', 'sampleLimit'],
		additionalProperties: false
	};

const KnownArchiveRemoteFailureV1Schema: JSONSchemaType<KnownArchiveRemoteFailureV1> =
	{
		type: 'object',
		properties: {
			networkVerifiedCopies: KnownArchiveVerifiedCopySetV1Schema,
			object: HistoryArchiveObjectV1Schema,
			sameOrganizationVerifiedCopies: KnownArchiveVerifiedCopySetV1Schema
		},
		required: [
			'networkVerifiedCopies',
			'object',
			'sameOrganizationVerifiedCopies'
		],
		additionalProperties: false
	};

const KnownArchiveFailureFiltersV1Schema: JSONSchemaType<KnownArchiveFailureFiltersV1> =
	{
		type: 'object',
		properties: {
			archiveUrlIdentity: nullable({ type: 'string' }),
			objectType: nullable({
				type: 'string',
				enum: [
					'history-archive-state',
					'checkpoint-state',
					'ledger',
					'transactions',
					'results',
					'scp',
					'bucket',
					null
				] as unknown as HistoryArchiveObjectTypeV1[]
			})
		},
		required: ['archiveUrlIdentity', 'objectType'],
		additionalProperties: false
	};

export const KnownArchiveRemoteFailurePageV1Schema: JSONSchemaType<KnownArchiveRemoteFailurePageV1> =
	{
		type: 'object',
		properties: {
			filters: KnownArchiveFailureFiltersV1Schema,
			failures: { type: 'array', items: KnownArchiveRemoteFailureV1Schema },
			hasMore: { type: 'boolean' },
			limit: { type: 'number' },
			nextCursor: nullable({ type: 'string' }),
			snapshotAt: { type: 'string', format: 'date-time' },
			total: { type: 'number' }
		},
		required: [
			'filters',
			'failures',
			'hasMore',
			'limit',
			'nextCursor',
			'snapshotAt',
			'total'
		],
		additionalProperties: false
	};

const KnownArchiveWorkerIssueV1Schema: JSONSchemaType<KnownArchiveWorkerIssueV1> =
	{
		type: 'object',
		properties: {
			evidenceClass: {
				type: 'string',
				enum: ['worker-infrastructure', 'coordinator-infrastructure']
			},
			object: HistoryArchiveObjectV1Schema
		},
		required: ['evidenceClass', 'object'],
		additionalProperties: false
	};

export const KnownArchiveWorkerIssuePageV1Schema: JSONSchemaType<KnownArchiveWorkerIssuePageV1> =
	{
		type: 'object',
		properties: {
			filters: KnownArchiveFailureFiltersV1Schema,
			hasMore: { type: 'boolean' },
			issues: { type: 'array', items: KnownArchiveWorkerIssueV1Schema },
			limit: { type: 'number' },
			nextCursor: nullable({ type: 'string' }),
			snapshotAt: { type: 'string', format: 'date-time' },
			total: { type: 'number' }
		},
		required: [
			'filters',
			'hasMore',
			'issues',
			'limit',
			'nextCursor',
			'snapshotAt',
			'total'
		],
		additionalProperties: false
	};
const KnownArchiveEvidenceTotalsV1Schema: JSONSchemaType<KnownArchiveEvidenceTotalsV1> =
	{
		type: 'object',
		properties: {
			archiveRoots: { type: 'number' },
			checkpoints: KnownArchiveCheckpointCountsV1Schema,
			nodes: { type: 'number' },
			objects: KnownArchiveObjectCountsV1Schema
		},
		required: ['archiveRoots', 'checkpoints', 'nodes', 'objects'],
		additionalProperties: false
	};

const commonProperties = {
	eventPage: HistoryArchiveObjectEventPageV1Schema,
	generatedAt: { type: 'string', format: 'date-time' },
	nodePublicKeys: { type: 'array', items: { type: 'string' } },
	objectPage: HistoryArchiveObjectPageV1Schema,
	remoteFailures: KnownArchiveRemoteFailurePageV1Schema,
	roots: { type: 'array', items: KnownArchiveRootEvidenceV1Schema },
	totals: KnownArchiveEvidenceTotalsV1Schema,
	workerIssues: KnownArchiveWorkerIssuePageV1Schema
} as const;

const commonRequired = [
	'eventPage',
	'generatedAt',
	'nodePublicKeys',
	'objectPage',
	'remoteFailures',
	'roots',
	'totals',
	'workerIssues'
] as const;

export const KnownNodeArchiveEvidenceV1Schema: JSONSchemaType<KnownNodeArchiveEvidenceV1> =
	{
		$id: 'known-node-archive-evidence-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			...commonProperties,
			organizationId: nullable({ type: 'string' }),
			publicKey: { type: 'string' }
		},
		required: [...commonRequired, 'organizationId', 'publicKey'],
		additionalProperties: false
	};

export const KnownOrganizationArchiveEvidenceV1Schema: JSONSchemaType<KnownOrganizationArchiveEvidenceV1> =
	{
		$id: 'known-organization-archive-evidence-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			...commonProperties,
			organizationId: { type: 'string' }
		},
		required: [...commonRequired, 'organizationId'],
		additionalProperties: false
	};
