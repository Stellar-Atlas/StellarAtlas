import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveStatusSummary,
	PublicScanLogStatus,
	PublicWorkerStatus
} from './types';
import { sanitizeStatusLiveField } from './status-live-sanitizers';
import { parseWorkerStatusDTO } from './worker-status-parser';

export interface StatusLiveSnapshot {
	readonly api: PublicApiStatus;
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveSummary: PublicHistoryArchiveStatusSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly generatedAt: string;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export type StatusLivePatch = Partial<StatusLiveSnapshot> & {
	readonly generatedAt: string;
};

const patchFields = new Set([
	'api',
	'archiveEvents',
	'archiveSummary',
	'dataQuality',
	'frontend',
	'generatedAt',
	'scanLogs',
	'workers'
]);
const snapshotFields = [
	'api',
	'archiveEvents',
	'archiveSummary',
	'dataQuality',
	'frontend',
	'scanLogs',
	'workers'
] as const;

type Validator = (value: unknown) => boolean;

export function parseStatusLivePayload(
	value: unknown,
	requireSnapshot: boolean
): StatusLivePatch | StatusLiveSnapshot | null {
	if (!isRecord(value) || !dateTime(value.generatedAt)) return null;
	if (!Object.keys(value).every((field) => patchFields.has(field))) return null;
	if (
		requireSnapshot &&
		!snapshotFields.every((field) => Object.hasOwn(value, field))
	) {
		return null;
	}

	const parsed: Record<string, unknown> = { generatedAt: value.generatedAt };
	for (const field of snapshotFields) {
		if (!Object.hasOwn(value, field)) continue;
		if (field === 'workers') {
			const workers = parseWorkerStatusDTO(value.workers);
			if (workers === null) return null;
			parsed.workers = workers;
			continue;
		}
		const validator = fieldValidators[field];
		if (!validator(value[field])) return null;
		parsed[field] = sanitizeStatusLiveField(field, value[field]);
	}

	return parsed as StatusLivePatch | StatusLiveSnapshot;
}

const fieldValidators: Readonly<
	Record<Exclude<(typeof snapshotFields)[number], 'workers'>, Validator>
> = {
	api: matches({
		generatedAt: dateTime,
		service: literal('api'),
		status: statusLevel
	}),
	archiveEvents: validateArchiveEvents,
	archiveSummary: validateArchiveSummary,
	dataQuality: validateDataQuality,
	frontend: matches({
		configured: boolean,
		configurationState: oneOf(
			'configured',
			'external_fallback',
			'not_configured'
		),
		generatedAt: dateTime,
		health: literal('not_probed'),
		probe: literal('not_run'),
		readiness: oneOf('configured_not_probed', 'external_fallback', 'planned'),
		requiredForProduction: boolean,
		service: oneOf('frontend', 'horizon', 'rpc'),
		status: statusLevel,
		url: nullable(string)
	}),
	scanLogs: validateScanLogs
};

const coverageFields = [
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
	'missingArchiveCheckpoints',
	'objectCompleteArchiveCheckpoints',
	'partialArchiveCheckpoints',
	'totalArchiveCheckpoints'
] as const;

function validateArchiveSummary(value: unknown): boolean {
	if (
		!matches({
			activeObjectChecks: nonNegativeInteger,
			archiveEvidenceFailures: nonNegativeInteger,
			checkpointCoverage: validateCoverage,
			generatedAt: dateTime,
			sourceCount: nonNegativeInteger,
			sourceLimit: positiveInteger,
			scannerIssueFailures: nonNegativeInteger,
			sources: arrayOf(validateArchiveSource, 256),
			sourcesTruncated: boolean,
			unclassifiedFailures: nonNegativeInteger
		})(value) ||
		!isRecord(value) ||
		!Array.isArray(value.sources)
	) {
		return false;
	}
	return (
		value.sources.length <= Number(value.sourceLimit) &&
		Number(value.sourceCount) >= value.sources.length &&
		value.sourcesTruncated === Number(value.sourceCount) > value.sources.length
	);
}

function validateCoverage(value: unknown): boolean {
	if (!isRecord(value)) return false;
	if (!coverageFields.every((field) => nonNegativeInteger(value[field]))) {
		return false;
	}
	return (
		nullable(nonNegativeInteger)(value.oldestCheckpointLedger) &&
		nullable(nonNegativeInteger)(value.latestCheckpointLedger)
	);
}

const validateArchiveSource = matches({
	activeObjectChecks: nonNegativeInteger,
	archiveEvidenceFailures: nonNegativeInteger,
	archiveUrl: nonEmptyString,
	archiveUrlIdentity: nonEmptyString,
	currentLedger: nullable(nonNegativeInteger),
	latestCheckpointLedger: nullable(nonNegativeInteger),
	latestDiscoveredCheckpointLedger: nullable(nonNegativeInteger),
	mismatchCheckpointProofs: nonNegativeInteger,
	notEvaluableCheckpointProofs: nonNegativeInteger,
	objectCompleteCheckpointProofs: nonNegativeInteger,
	observedAt: dateTime,
	pendingCheckpointProofs: nonNegativeInteger,
	rootObjectStatus: nullable(
		oneOf('pending', 'scanning', 'verified', 'failed')
	),
	rootFailureChannel: nullable(oneOf('archive_evidence', 'scanner_issue')),
	scannerIssueFailures: nonNegativeInteger,
	source: oneOf('backfill', 'history-scanner', 'network-scan'),
	stateStatus: oneOf('available', 'invalid', 'unreachable'),
	stateUrl: nonEmptyString,
	totalCheckpointProofs: nonNegativeInteger,
	unclassifiedFailures: nonNegativeInteger,
	verifiedCheckpointProofs: nonNegativeInteger
});

function validateArchiveEvents(value: unknown): boolean {
	return matches({
		count: nonNegativeInteger,
		events: arrayOf(validateArchiveEvent, 100),
		generatedAt: dateTime,
		limit: positiveInteger
	})(value);
}

const validateArchiveEvent = matches({
	archiveUrl: nonEmptyString,
	archiveUrlIdentity: nonEmptyString,
	bucketHash: nullable(string),
	bytesDownloaded: nullable(nonNegativeInteger),
	checkpointLedger: nullable(nonNegativeInteger),
	claimAttempt: nullable(positiveInteger),
	createdAt: dateTime,
	error: nullable(
		matches({
			httpStatus: nullable(nonNegativeInteger),
			message: string,
			type: string
		})
	),
	eventType: oneOf('claimed', 'heartbeat', 'verified', 'failed', 'released'),
	evidenceClass: nullable(
		oneOf(
			'archive-object',
			'worker-infrastructure',
			'coordinator-infrastructure'
		)
	),
	nextAttemptAt: nullable(dateTime),
	objectKey: nonEmptyString,
	objectRemoteId: uuid,
	objectType: oneOf(
		'history-archive-state',
		'checkpoint-state',
		'ledger',
		'transactions',
		'results',
		'scp',
		'bucket'
	),
	objectUrl: nonEmptyString,
	remoteId: uuid,
	verificationFacts: literal(null),
	workerStage: nullable(string)
});

function validateDataQuality(value: unknown): boolean {
	return matches({
		archiveQueue: matches({
			activeJobs: nonNegativeInteger,
			generatedAt: dateTime,
			pendingJobs: nonNegativeInteger,
			staleJobAgeMs: nonNegativeInteger,
			staleJobs: nonNegativeInteger,
			status: statusLevel,
			totalUnfinishedJobs: nonNegativeInteger
		}),
		dataFreshness: validateFreshness,
		generatedAt: dateTime,
		rollups: validateRollups,
		scans: validateScans,
		status: statusLevel
	})(value);
}

const freshnessProbe = matches({
	ageMs: nullable(nonNegativeInteger),
	latestAt: nullable(dateTime),
	staleAfterMs: nullable(nonNegativeInteger),
	status: statusLevel
});
const archiveFreshnessProbe = matches({
	ageMs: nullable(nonNegativeInteger),
	drivesPlatformStatus: literal(false),
	drivesRuntimeHealth: literal(false),
	latestAt: nullable(dateTime),
	source: literal('archive_object_evidence'),
	staleAfterMs: nullable(nonNegativeInteger),
	status: statusLevel
});
const legacyArchiveScanProbe = matches({
	ageMs: nullable(nonNegativeInteger),
	deprecated: literal(true),
	drivesPlatformStatus: literal(false),
	drivesRuntimeHealth: literal(false),
	historical: literal(true),
	latestAt: nullable(dateTime),
	source: literal('legacy_range_scan'),
	staleAfterMs: nullable(nonNegativeInteger),
	status: statusLevel
});
const transitionalArchiveScanProbe = matches({
	ageMs: nullable(nonNegativeInteger),
	deprecated: literal(true),
	drivesPlatformStatus: literal(false),
	drivesRuntimeHealth: literal(false),
	latestAt: nullable(dateTime),
	source: literal('archive_object_evidence'),
	staleAfterMs: nullable(nonNegativeInteger),
	status: statusLevel
});

function validateFreshness(value: unknown): boolean {
	return matches({
		archiveEvidence: archiveFreshnessProbe,
		archiveScan: oneOfType(
			legacyArchiveScanProbe,
			transitionalArchiveScanProbe
		),
		generatedAt: dateTime,
		networkScan: freshnessProbe,
		status: statusLevel
	})(value);
}

function validateScans(value: unknown): boolean {
	return matches({
		generatedAt: dateTime,
		networkScan: matches({
			completedScans: nonNegativeInteger,
			completionRate: nullable(number),
			expectedCompletionRate: nullable(number),
			expectedScans: nonNegativeInteger,
			incompleteScans: nonNegativeInteger,
			latestCompletedScanAt: nullable(dateTime),
			latestScanAt: nullable(dateTime),
			scanIntervalMs: nonNegativeInteger,
			status: statusLevel,
			totalScans: nonNegativeInteger,
			windowEnd: dateTime,
			windowMs: nonNegativeInteger,
			windowStart: dateTime
		}),
		status: statusLevel
	})(value);
}

function validateRollups(value: unknown): boolean {
	return matches({
		generatedAt: dateTime,
		networkRollups: matches(
			{
				daysWithCompletedScans: nonNegativeInteger,
				daysWithRollups: nonNegativeInteger,
				latestRollupDay: nullable(dateTime),
				matchingDays: nonNegativeInteger,
				mismatchedRollupDays: nonNegativeInteger,
				missingRollupDays: nonNegativeInteger,
				rawCompletedScans: nonNegativeInteger,
				rollupCrawlCount: nonNegativeInteger,
				status: statusLevel,
				windowDays: nonNegativeInteger,
				windowEnd: dateTime,
				windowStart: dateTime
			},
			{ days: arrayOf(validateRollupDay, 32) }
		),
		status: statusLevel
	})(value);
}

const validateRollupDay = matches({
	day: dateTime,
	hasRollup: boolean,
	matchesRawCompletedScans: boolean,
	rawCompletedScans: nonNegativeInteger,
	rollupCrawlCount: nullable(nonNegativeInteger),
	status: statusLevel
});

function validateScanLogs(value: unknown): boolean {
	return matches({
		archiveScans: arrayOf(validateArchiveScanLog, 50),
		archiveScansDeprecated: literal(true),
		archiveScansHistorical: literal(true),
		generatedAt: dateTime,
		limit: positiveInteger,
		networkScans: arrayOf(validateNetworkScanLog, 50)
	})(value);
}

const scanError = matches({ message: string, type: string, url: string });
const validateArchiveScanLog = matches(
	{
		concurrency: oneOfType(
			nonNegativeInteger,
			literal('pending'),
			literal('unknown'),
			literal(null)
		),
		durationMs: nonNegativeInteger,
		endDate: dateTime,
		errorCount: nonNegativeInteger,
		errors: arrayOf(scanError, 500),
		fromLedger: nonNegativeInteger,
		hasArchiveVerificationError: boolean,
		hasWorkerIssue: boolean,
		latestScannedLedger: nonNegativeInteger,
		latestVerifiedLedger: nonNegativeInteger,
		scanStatus: oneOf('ok', 'archive_error', 'worker_issue'),
		startDate: dateTime,
		toLedger: nullable(nonNegativeInteger),
		url: string
	},
	{ latestAttemptedLedger: nullable(nonNegativeInteger) }
);

const validateNetworkScanLog = matches({
	archiveScheduling: matches({
		discoveredArchiveUrlCount: nonNegativeInteger,
		duplicateSuppressedArchiveScanJobCount: nonNegativeInteger,
		scheduledArchiveScanJobCount: nonNegativeInteger,
		schedulerErrorCount: nonNegativeInteger
	}),
	completed: boolean,
	latestLedger: nonEmptyString,
	latestLedgerCloseTime: nullable(dateTime),
	ledgersCount: nonNegativeInteger,
	status: oneOf('ok', 'incomplete'),
	time: dateTime
});

function matches(
	required: Readonly<Record<string, Validator>>,
	optional: Readonly<Record<string, Validator>> = {}
): Validator {
	return (value) => {
		if (!isRecord(value)) return false;
		for (const [field, validator] of Object.entries(required)) {
			if (!Object.hasOwn(value, field) || !validator(value[field]))
				return false;
		}
		for (const [field, validator] of Object.entries(optional)) {
			if (Object.hasOwn(value, field) && !validator(value[field])) return false;
		}
		return true;
	};
}

function arrayOf(validator: Validator, limit: number): Validator {
	return (value) =>
		Array.isArray(value) &&
		value.length <= limit &&
		value.every((entry) => validator(entry));
}

function nullable(validator: Validator): Validator {
	return (value) => value === null || validator(value);
}

function oneOf(...values: readonly unknown[]): Validator {
	return (value) => values.includes(value);
}

function oneOfType(...validators: readonly Validator[]): Validator {
	return (value) => validators.some((validator) => validator(value));
}

function literal(expected: unknown): Validator {
	return (value) => value === expected;
}

function boolean(value: unknown): value is boolean {
	return typeof value === 'boolean';
}

function string(value: unknown): value is string {
	return typeof value === 'string';
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function number(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function positiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function dateTime(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function statusLevel(value: unknown): boolean {
	return value === 'ok' || value === 'degraded' || value === 'unavailable';
}

function uuid(value: unknown): boolean {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			value
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
