import type { JSONSchemaType } from 'ajv';
import { nullable } from './helper/nullable.js';
import {
	HistoryArchiveCheckpointCoverageV1Schema,
	type HistoryArchiveCheckpointCoverageV1
} from './history-archive-object-summary-v1.js';

export interface HistoryArchiveStatusSourceV1 {
	readonly activeObjectChecks: number;
	readonly archiveEvidenceFailures: number;
	readonly archiveUrl: string;
	readonly archiveUrlIdentity: string;
	readonly currentLedger: number | null;
	readonly durableVerifiedCheckpointProofs: number;
	readonly latestCheckpointLedger: number | null;
	readonly latestDiscoveredCheckpointLedger: number | null;
	readonly mismatchCheckpointProofs: number;
	readonly notEvaluableCheckpointProofs: number;
	readonly objectCompleteCheckpointProofs: number;
	readonly observedAt: string;
	readonly pendingCheckpointProofs: number;
	readonly rootObjectStatus:
		'pending' | 'scanning' | 'verified' | 'failed' | null;
	readonly rootFailureChannel:
		'archive_evidence' | 'archive_availability' | 'scanner_issue' | null;
	readonly scannerIssueFailures: number;
	readonly source: 'backfill' | 'history-scanner' | 'network-scan';
	readonly stateStatus: 'available' | 'invalid' | 'unreachable';
	readonly stateUrl: string;
	readonly totalCheckpointProofs: number;
	readonly unclassifiedFailures: number;
	readonly verifiedCheckpointProofs: number;
}

export interface HistoryArchiveTransitionReconciliationV1 {
	readonly oldestPendingAgeMs: number | null;
	readonly oldestPendingAt: string | null;
	readonly pendingTerminalEffects: number;
	readonly status: 'caught-up' | 'reconciling' | 'stalled';
}

export interface HistoryArchiveCanonicalProofProgressV1 {
	readonly archiveUrl: string | null;
	readonly archiveUrlIdentity: string | null;
	readonly latestVerifiedCheckpointLedger: number | null;
	readonly nextCheckpointLedger: number | null;
	readonly remainingCheckpoints: number;
	readonly targetCheckpointLedger: number | null;
	readonly totalCheckpoints: number;
	readonly verifiedCheckpoints: number;
}

export interface HistoryArchiveStatusSummaryV1 {
	readonly activeObjectChecks: number;
	readonly archiveEvidenceFailures: number;
	readonly canonicalProofProgress: HistoryArchiveCanonicalProofProgressV1;
	readonly checkpointCoverage: HistoryArchiveCheckpointCoverageV1;
	readonly generatedAt: string;
	readonly sourceCount: number;
	readonly sourceLimit: number;
	readonly scannerIssueFailures: number;
	readonly sources: readonly HistoryArchiveStatusSourceV1[];
	readonly sourcesTruncated: boolean;
	readonly transitionReconciliation: HistoryArchiveTransitionReconciliationV1;
	readonly unclassifiedFailures: number;
}

const HistoryArchiveStatusSourceV1Schema: JSONSchemaType<HistoryArchiveStatusSourceV1> =
	{
		type: 'object',
		properties: {
			activeObjectChecks: { type: 'number' },
			archiveEvidenceFailures: { type: 'number' },
			archiveUrl: { type: 'string' },
			archiveUrlIdentity: { type: 'string' },
			currentLedger: nullable({ type: 'number' }),
			durableVerifiedCheckpointProofs: { type: 'number' },
			latestCheckpointLedger: nullable({ type: 'number' }),
			latestDiscoveredCheckpointLedger: nullable({ type: 'number' }),
			mismatchCheckpointProofs: { type: 'number' },
			notEvaluableCheckpointProofs: { type: 'number' },
			objectCompleteCheckpointProofs: { type: 'number' },
			observedAt: { type: 'string', format: 'date-time' },
			pendingCheckpointProofs: { type: 'number' },
			rootObjectStatus: nullable({
				type: 'string',
				enum: [
					'pending',
					'scanning',
					'verified',
					'failed',
					null
				] as unknown as NonNullable<
					HistoryArchiveStatusSourceV1['rootObjectStatus']
				>[]
			}),
			rootFailureChannel: nullable({
				type: 'string',
				enum: [
					'archive_evidence',
					'archive_availability',
					'scanner_issue',
					null
				] as unknown as NonNullable<
					HistoryArchiveStatusSourceV1['rootFailureChannel']
				>[]
			}),
			scannerIssueFailures: { type: 'number' },
			source: {
				type: 'string',
				enum: ['backfill', 'history-scanner', 'network-scan']
			},
			stateStatus: {
				type: 'string',
				enum: ['available', 'invalid', 'unreachable']
			},
			stateUrl: { type: 'string' },
			totalCheckpointProofs: { type: 'number' },
			unclassifiedFailures: { type: 'number' },
			verifiedCheckpointProofs: { type: 'number' }
		},
		required: [
			'activeObjectChecks',
			'archiveEvidenceFailures',
			'archiveUrl',
			'archiveUrlIdentity',
			'currentLedger',
			'durableVerifiedCheckpointProofs',
			'latestCheckpointLedger',
			'latestDiscoveredCheckpointLedger',
			'mismatchCheckpointProofs',
			'notEvaluableCheckpointProofs',
			'objectCompleteCheckpointProofs',
			'observedAt',
			'pendingCheckpointProofs',
			'rootObjectStatus',
			'rootFailureChannel',
			'scannerIssueFailures',
			'source',
			'stateStatus',
			'stateUrl',
			'totalCheckpointProofs',
			'unclassifiedFailures',
			'verifiedCheckpointProofs'
		],
		additionalProperties: false
	};

const HistoryArchiveTransitionReconciliationV1Schema: JSONSchemaType<HistoryArchiveTransitionReconciliationV1> =
	{
		type: 'object',
		properties: {
			oldestPendingAgeMs: nullable({ type: 'number', minimum: 0 }),
			oldestPendingAt: nullable({ type: 'string', format: 'date-time' }),
			pendingTerminalEffects: { type: 'number', minimum: 0 },
			status: {
				type: 'string',
				enum: ['caught-up', 'reconciling', 'stalled']
			}
		},
		required: [
			'oldestPendingAgeMs',
			'oldestPendingAt',
			'pendingTerminalEffects',
			'status'
		],
		additionalProperties: false
	};

const HistoryArchiveCanonicalProofProgressV1Schema: JSONSchemaType<HistoryArchiveCanonicalProofProgressV1> =
	{
		type: 'object',
		properties: {
			archiveUrl: nullable({ type: 'string' }),
			archiveUrlIdentity: nullable({ type: 'string' }),
			latestVerifiedCheckpointLedger: nullable({
				type: 'number',
				minimum: 0
			}),
			nextCheckpointLedger: nullable({ type: 'number', minimum: 0 }),
			remainingCheckpoints: { type: 'number', minimum: 0 },
			targetCheckpointLedger: nullable({ type: 'number', minimum: 0 }),
			totalCheckpoints: { type: 'number', minimum: 0 },
			verifiedCheckpoints: { type: 'number', minimum: 0 }
		},
		required: [
			'archiveUrl',
			'archiveUrlIdentity',
			'latestVerifiedCheckpointLedger',
			'nextCheckpointLedger',
			'remainingCheckpoints',
			'targetCheckpointLedger',
			'totalCheckpoints',
			'verifiedCheckpoints'
		],
		additionalProperties: false
	};

export const HistoryArchiveStatusSummaryV1Schema: JSONSchemaType<HistoryArchiveStatusSummaryV1> =
	{
		$id: 'history-archive-status-summary-v1.json',
		$schema: 'http://json-schema.org/draft-07/schema#',
		type: 'object',
		properties: {
			activeObjectChecks: { type: 'number' },
			archiveEvidenceFailures: { type: 'number' },
			canonicalProofProgress: HistoryArchiveCanonicalProofProgressV1Schema,
			checkpointCoverage: HistoryArchiveCheckpointCoverageV1Schema,
			generatedAt: { type: 'string', format: 'date-time' },
			sourceCount: { type: 'number' },
			sourceLimit: { type: 'number', minimum: 1, maximum: 256 },
			scannerIssueFailures: { type: 'number' },
			sources: {
				type: 'array',
				maxItems: 256,
				items: HistoryArchiveStatusSourceV1Schema
			},
			sourcesTruncated: { type: 'boolean' },
			transitionReconciliation: HistoryArchiveTransitionReconciliationV1Schema,
			unclassifiedFailures: { type: 'number' }
		},
		required: [
			'activeObjectChecks',
			'archiveEvidenceFailures',
			'canonicalProofProgress',
			'checkpointCoverage',
			'generatedAt',
			'sourceCount',
			'sourceLimit',
			'scannerIssueFailures',
			'sources',
			'sourcesTruncated',
			'transitionReconciliation',
			'unclassifiedFailures'
		],
		additionalProperties: false
	};
