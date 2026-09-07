import type { JSONSchemaType } from 'ajv';
import type { HistoryArchiveObjectTypeV1 } from './history-archive-object-v1.js';
import { nullable } from './helper/nullable.js';

export interface KnownArchiveFailureReasonV1 {
	readonly objectType: HistoryArchiveObjectTypeV1;
	readonly failureChannel: 'archive_evidence' | 'archive_availability';
	readonly errorType: string | null;
	/** Exact recorded reason, subject to the existing public infrastructure redaction. */
	readonly errorMessage: string | null;
	readonly httpStatus: number | null;
	readonly count: number;
	/** Distinct category checkpoints with retained metadata; not a sum across groups. */
	readonly knownAffectedCheckpointCount?: number;
	/** Findings without an attributable category checkpoint, including bucket/root checks. */
	readonly unknownCheckpointFailureCount?: number;
}

/** Source-detail only. Independent cached snapshot; never inferred from a failure page. */
export interface KnownArchiveFailureSummaryV1 {
	readonly status: 'current' | 'stale' | 'unavailable';
	readonly computedAt: string | null;
	readonly groups: readonly KnownArchiveFailureReasonV1[];
	readonly limit: number;
	readonly totalGroups: number | null;
	readonly remainingGroupCount: number | null;
	readonly remainingFailureCount: number | null;
	readonly remoteFailureCount: number | null;
	/** Separate diagnostic count; worker issues never consume source reason groups. */
	readonly workerIssueCount: number | null;
	readonly knownAffectedCheckpointCount?: number;
	readonly unknownCheckpointFailureCount?: number;
}

const count = { type: 'integer', minimum: 0 } as const;
export const KnownArchiveFailureSummaryV1Schema: JSONSchemaType<KnownArchiveFailureSummaryV1> =
	{
		type: 'object',
		properties: {
			status: { type: 'string', enum: ['current', 'stale', 'unavailable'] },
			computedAt: nullable({ type: 'string', format: 'date-time' }),
			groups: {
				type: 'array',
				maxItems: 20,
				items: {
					type: 'object',
					properties: {
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
						failureChannel: {
							type: 'string',
							enum: ['archive_evidence', 'archive_availability']
						},
						errorType: nullable({ type: 'string', maxLength: 4096 }),
						errorMessage: nullable({ type: 'string', maxLength: 4096 }),
						httpStatus: nullable({
							type: 'integer',
							minimum: 100,
							maximum: 599
						}),
						count,
						knownAffectedCheckpointCount: { ...count, nullable: true },
						unknownCheckpointFailureCount: { ...count, nullable: true }
					},
					required: [
						'objectType',
						'failureChannel',
						'errorType',
						'errorMessage',
						'httpStatus',
						'count'
					],
					additionalProperties: false
				}
			},
			limit: { type: 'integer', minimum: 1, maximum: 20 },
			totalGroups: nullable(count),
			remainingGroupCount: nullable(count),
			remainingFailureCount: nullable(count),
			remoteFailureCount: nullable(count),
			workerIssueCount: nullable(count),
			knownAffectedCheckpointCount: { ...count, nullable: true },
			unknownCheckpointFailureCount: { ...count, nullable: true }
		},
		required: [
			'status',
			'computedAt',
			'groups',
			'limit',
			'totalGroups',
			'remainingGroupCount',
			'remainingFailureCount',
			'remoteFailureCount',
			'workerIssueCount'
		],
		additionalProperties: false
	};
