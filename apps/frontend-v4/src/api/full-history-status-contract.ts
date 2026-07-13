import type { PublicFullHistoryStatus } from './types';
import { validateCanonicalFullHistoryCoverage } from './canonical-history-contract';
import { sanitizeFullHistoryStatus } from './status-live-sanitizers';
import {
	boolean,
	dateTime,
	literal,
	matches,
	nonNegativeInteger,
	nullable,
	oneOf,
	statusLevel,
	string,
	type StatusLiveValidator,
	unsignedIntegerString
} from './status-live-validator-primitives';

const validateCanonicalPromotion = matches({
	checkpointLedger: nullable(unsignedIntegerString),
	heartbeatAt: dateTime,
	lastAttemptAt: nullable(dateTime),
	lastErrorCode: nullable(string),
	lastFailureAt: nullable(dateTime),
	lastOutcome: nullable(
		oneOf('bootstrap-required', 'proof-pending', 'promoted', 'replayed')
	),
	lastSuccessAt: nullable(dateTime),
	nextLedger: nullable(unsignedIntegerString),
	startedAt: dateTime,
	state: oneOf(
		'failed',
		'promoting',
		'running',
		'stale',
		'stopped',
		'waiting-for-proof'
	)
});

const validateHistoricalBackfill = matches({
	failedJobs: nonNegativeInteger,
	latestErrorCode: nullable(string),
	nextCheckpointLedger: nullable(unsignedIntegerString),
	pendingJobs: nonNegativeInteger,
	runningJobs: nonNegativeInteger,
	state: oneOf(
		'complete',
		'failed',
		'idle',
		'queued',
		'running',
		'waiting-for-proof'
	),
	updatedAt: nullable(dateTime)
});

export const validateFullHistoryStatus: StatusLiveValidator = matches({
	canonicalCoverage: nullable(validateCanonicalFullHistoryCoverage),
	canonicalPromotion: nullable(validateCanonicalPromotion),
	earliestParsedLedger: nullable(unsignedIntegerString),
	generatedAt: dateTime,
	historicalBackfill: nullable(validateHistoricalBackfill),
	latestObservedAt: nullable(dateTime),
	latestParsedLedger: nullable(unsignedIntegerString),
	localAssetIndexReady: boolean,
	localContractIndexReady: boolean,
	localOperationIndexReady: boolean,
	localTransactionIndexReady: boolean,
	mode: oneOf('archive_header_parser', 'canonical_checkpoint_index'),
	parsedLedgerCount: nullable(nonNegativeInteger),
	sourceArchiveCount: nullable(nonNegativeInteger),
	status: statusLevel
});

export function parseFullHistoryStatus(
	value: unknown
): PublicFullHistoryStatus | null {
	if (!validateFullHistoryStatus(value)) return null;
	return sanitizeFullHistoryStatus(value) as unknown as PublicFullHistoryStatus;
}
