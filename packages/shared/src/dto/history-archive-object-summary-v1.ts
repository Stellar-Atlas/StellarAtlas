import { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';

export interface HistoryArchiveObjectStatusCountsV1 {
	readonly activeObjects: number;
	readonly failedObjects: number;
	readonly pendingObjects: number;
	readonly totalObjects: number;
	readonly verifiedObjects: number;
}

export interface HistoryArchiveObjectTypeSummaryV1 extends HistoryArchiveObjectStatusCountsV1 {
	readonly objectType: HistoryArchiveObjectTypeV1;
}

export interface HistoryArchiveSourceSummaryV1 extends HistoryArchiveObjectStatusCountsV1 {
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly currentLedger: number | null;
	readonly latestCheckpointLedger: number | null;
	readonly latestDiscoveredCheckpointLedger: number | null;
	readonly objectCompleteCheckpoints: number;
	readonly observedAt: string;
	readonly rootObjectStatus:
		| 'pending'
		| 'scanning'
		| 'verified'
		| 'failed'
		| null;
	readonly source: 'backfill' | 'history-scanner' | 'network-scan';
	readonly stateStatus: 'available' | 'invalid' | 'unreachable';
	readonly stateUrl: string;
	readonly verifiedCheckpoints: number;
}

export interface HistoryArchiveCheckpointCoverageV1 {
	readonly activeArchiveCheckpoints: number;
	readonly archiveRootsWithState: number;
	readonly categoryConsistencyFailedCheckpoints: number;
	readonly categoryConsistencyNotEvaluatedCheckpoints: number;
	readonly categoryConsistencyPendingCheckpoints: number;
	readonly categoryConsistentArchiveCheckpoints: number;
	readonly completeArchiveCheckpoints: number;
	readonly discoveryCompleteArchiveRoots: number;
	readonly expectedArchiveCheckpoints: number;
	readonly failedArchiveCheckpoints: number;
	readonly latestCheckpointLedger: number | null;
	readonly missingArchiveCheckpoints: number;
	readonly objectCompleteArchiveCheckpoints: number;
	readonly oldestCheckpointLedger: number | null;
	readonly partialArchiveCheckpoints: number;
	readonly totalArchiveCheckpoints: number;
}

export interface HistoryArchiveBucketCoverageV1 {
	readonly activeBucketObjects: number;
	readonly failedBucketObjects: number;
	readonly pendingBucketObjects: number;
	readonly totalBucketObjects: number;
	readonly uniqueBucketHashes: number;
	readonly verifiedBucketObjects: number;
}

export type HistoryArchiveObjectFailureClassV1 =
	| 'http'
	| 'auth'
	| 'not-found'
	| 'rate-limit'
	| 'timeout'
	| 'transport'
	| 'worker'
	| 'coordinator'
	| 'unknown';

export type HistoryArchiveObjectEvidenceClassV1 =
	'archive-object' | 'worker-infrastructure' | 'coordinator-infrastructure';

export interface HistoryArchiveObjectHostThrottleV1 {
	readonly archiveUrlIdentity: string;
	readonly blockedUntil: string;
	readonly consecutiveFailures: number;
	readonly errorType: string;
	readonly evidenceClass: HistoryArchiveObjectEvidenceClassV1;
	readonly failureClass: HistoryArchiveObjectFailureClassV1;
	readonly hostIdentity: string;
	readonly httpStatus: number | null;
	readonly lastFailureAt: string;
}

export interface HistoryArchiveObjectSummaryV1 extends HistoryArchiveObjectStatusCountsV1 {
	readonly archiveUrl: string | null;
	readonly archiveUrlIdentity: string | null;
	readonly buckets: HistoryArchiveBucketCoverageV1;
	readonly checkpoints: HistoryArchiveCheckpointCoverageV1;
	readonly generatedAt: string;
	readonly hostThrottles: readonly HistoryArchiveObjectHostThrottleV1[];
	readonly objectTypes: readonly HistoryArchiveObjectTypeSummaryV1[];
	readonly scope: 'archive' | 'global';
	readonly sources: readonly HistoryArchiveSourceSummaryV1[];
}

const HistoryArchiveObjectStatusCountsV1Schema: JSONSchemaType<HistoryArchiveObjectStatusCountsV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			failedObjects: { type: 'number' },
			pendingObjects: { type: 'number' },
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'failedObjects',
			'pendingObjects',
			'totalObjects',
			'verifiedObjects'
		],
		additionalProperties: false
	};

const HistoryArchiveObjectTypeSummaryV1Schema: JSONSchemaType<HistoryArchiveObjectTypeSummaryV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			failedObjects: { type: 'number' },
			pendingObjects: { type: 'number' },
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' },
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
			}
		},
		required: [
			'activeObjects',
			'failedObjects',
			'pendingObjects',
			'totalObjects',
			'verifiedObjects',
			'objectType'
		],
		additionalProperties: false
	};

const HistoryArchiveSourceSummaryV1Schema: JSONSchemaType<HistoryArchiveSourceSummaryV1> =
	{
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			currentLedger: nullable({ type: 'number' }),
			failedObjects: { type: 'number' },
			latestCheckpointLedger: nullable({ type: 'number' }),
			latestDiscoveredCheckpointLedger: nullable({ type: 'number' }),
			objectCompleteCheckpoints: { type: 'number' },
			observedAt: { type: 'string', format: 'date-time' },
			pendingObjects: { type: 'number' },
			rootObjectStatus: nullable({
				type: 'string',
				enum: ['pending', 'scanning', 'verified', 'failed']
			}),
			source: {
				type: 'string',
				enum: ['backfill', 'history-scanner', 'network-scan']
			},
			stateStatus: {
				type: 'string',
				enum: ['available', 'invalid', 'unreachable']
			},
			stateUrl: { type: 'string' },
			totalObjects: { type: 'number' },
			verifiedCheckpoints: { type: 'number' },
			verifiedObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'archiveUrl',
			'archiveUrlIdentity',
			'currentLedger',
			'failedObjects',
			'latestCheckpointLedger',
			'latestDiscoveredCheckpointLedger',
			'objectCompleteCheckpoints',
			'observedAt',
			'pendingObjects',
			'rootObjectStatus',
			'source',
			'stateStatus',
			'stateUrl',
			'totalObjects',
			'verifiedCheckpoints',
			'verifiedObjects'
		],
		additionalProperties: false
	};

const HistoryArchiveCheckpointCoverageV1Schema: JSONSchemaType<HistoryArchiveCheckpointCoverageV1> =
	{
		type: 'object',
		properties: {
			activeArchiveCheckpoints: { type: 'number' },
			archiveRootsWithState: { type: 'number' },
			categoryConsistencyFailedCheckpoints: { type: 'number' },
			categoryConsistencyNotEvaluatedCheckpoints: { type: 'number' },
			categoryConsistencyPendingCheckpoints: { type: 'number' },
			categoryConsistentArchiveCheckpoints: { type: 'number' },
			completeArchiveCheckpoints: { type: 'number' },
			discoveryCompleteArchiveRoots: { type: 'number' },
			expectedArchiveCheckpoints: { type: 'number' },
			failedArchiveCheckpoints: { type: 'number' },
			latestCheckpointLedger: nullable({ type: 'number' }),
			missingArchiveCheckpoints: { type: 'number' },
			objectCompleteArchiveCheckpoints: { type: 'number' },
			oldestCheckpointLedger: nullable({ type: 'number' }),
			partialArchiveCheckpoints: { type: 'number' },
			totalArchiveCheckpoints: { type: 'number' }
		},
		required: [
			'activeArchiveCheckpoints',
			'archiveRootsWithState',
			'categoryConsistencyFailedCheckpoints',
			'categoryConsistencyNotEvaluatedCheckpoints',
			'categoryConsistencyPendingCheckpoints',
			'categoryConsistentArchiveCheckpoints',
			'completeArchiveCheckpoints',
			'discoveryCompleteArchiveRoots',
			'expectedArchiveCheckpoints',
			'failedArchiveCheckpoints',
			'latestCheckpointLedger',
			'missingArchiveCheckpoints',
			'objectCompleteArchiveCheckpoints',
			'oldestCheckpointLedger',
			'partialArchiveCheckpoints',
			'totalArchiveCheckpoints'
		],
		additionalProperties: false
	};

const HistoryArchiveBucketCoverageV1Schema: JSONSchemaType<HistoryArchiveBucketCoverageV1> =
	{
		type: 'object',
		properties: {
			activeBucketObjects: { type: 'number' },
			failedBucketObjects: { type: 'number' },
			pendingBucketObjects: { type: 'number' },
			totalBucketObjects: { type: 'number' },
			uniqueBucketHashes: { type: 'number' },
			verifiedBucketObjects: { type: 'number' }
		},
		required: [
			'activeBucketObjects',
			'failedBucketObjects',
			'pendingBucketObjects',
			'totalBucketObjects',
			'uniqueBucketHashes',
			'verifiedBucketObjects'
		],
		additionalProperties: false
	};

const HistoryArchiveObjectHostThrottleV1Schema: JSONSchemaType<HistoryArchiveObjectHostThrottleV1> =
	{
		type: 'object',
		properties: {
			archiveUrlIdentity: { type: 'string' },
			blockedUntil: { type: 'string', format: 'date-time' },
			consecutiveFailures: { type: 'number' },
			errorType: { type: 'string' },
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
			hostIdentity: { type: 'string' },
			httpStatus: nullable({ type: 'number' }),
			lastFailureAt: { type: 'string', format: 'date-time' }
		},
		required: [
			'archiveUrlIdentity',
			'blockedUntil',
			'consecutiveFailures',
			'errorType',
			'evidenceClass',
			'failureClass',
			'hostIdentity',
			'httpStatus',
			'lastFailureAt'
		],
		additionalProperties: false
	};

export const HistoryArchiveObjectSummaryV1Schema: JSONSchemaType<HistoryArchiveObjectSummaryV1> =
	{
		$id: 'history-archive-object-summary-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			activeObjects: { type: 'number' },
			archiveUrl: nullable({ type: 'string' }),
			archiveUrlIdentity: nullable({ type: 'string' }),
			buckets: HistoryArchiveBucketCoverageV1Schema,
			checkpoints: HistoryArchiveCheckpointCoverageV1Schema,
			failedObjects: { type: 'number' },
			generatedAt: { type: 'string', format: 'date-time' },
			hostThrottles: {
				type: 'array',
				items: HistoryArchiveObjectHostThrottleV1Schema
			},
			objectTypes: {
				type: 'array',
				items: HistoryArchiveObjectTypeSummaryV1Schema
			},
			pendingObjects: { type: 'number' },
			scope: { type: 'string', enum: ['archive', 'global'] },
			sources: {
				type: 'array',
				items: HistoryArchiveSourceSummaryV1Schema
			},
			totalObjects: { type: 'number' },
			verifiedObjects: { type: 'number' }
		},
		required: [
			'activeObjects',
			'archiveUrl',
			'archiveUrlIdentity',
			'buckets',
			'checkpoints',
			'failedObjects',
			'generatedAt',
			'hostThrottles',
			'objectTypes',
			'pendingObjects',
			'scope',
			'sources',
			'totalObjects',
			'verifiedObjects'
		],
		additionalProperties: false
	};
