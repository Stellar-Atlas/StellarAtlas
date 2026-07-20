import { sanitizeCanonicalFullHistoryCoverage } from './canonical-history-contract';
import {
	createEmptyFullHistoryLedgerCloseMetaStateStatus,
	sanitizeFullHistoryLedgerCloseMetaStateStatus
} from './full-history-state-status';

type SanitizedField =
	| 'api'
	| 'archiveEvents'
	| 'archiveSummary'
	| 'dataQuality'
	| 'frontend'
	| 'fullHistory'
	| 'scanLogs';

export function sanitizeStatusLiveField(
	field: SanitizedField,
	value: unknown
): unknown {
	if (field === 'api') return pick(value, ['generatedAt', 'service', 'status']);
	if (field === 'archiveEvents') return sanitizeArchiveEvents(value);
	if (field === 'archiveSummary') return sanitizeArchiveSummary(value);
	if (field === 'dataQuality') return sanitizeDataQuality(value);
	if (field === 'frontend') {
		return pick(value, [
			'configured',
			'configurationState',
			'generatedAt',
			'health',
			'probe',
			'readiness',
			'requiredForProduction',
			'service',
			'status',
			'url'
		]);
	}
	if (field === 'fullHistory') return sanitizeFullHistoryStatus(value);
	return sanitizeScanLogs(value);
}

export function sanitizeFullHistoryStatus(
	value: unknown
): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, [
			'earliestParsedLedger',
			'generatedAt',
			'latestObservedAt',
			'latestParsedLedger',
			'localAssetIndexReady',
			'localContractIndexReady',
			'localOperationIndexReady',
			'localTransactionIndexReady',
			'mode',
			'parsedLedgerCount',
			'sourceArchiveCount',
			'status'
		]),
		canonicalCoverage:
			source.canonicalCoverage === null
				? null
				: sanitizeCanonicalFullHistoryCoverage(source.canonicalCoverage),
		canonicalPromotion:
			source.canonicalPromotion === null
				? null
				: pick(source.canonicalPromotion, [
						'checkpointLedger',
						'heartbeatAt',
						'lastAttemptAt',
						'lastErrorCode',
						'lastFailureAt',
						'lastOutcome',
						'lastSuccessAt',
						'nextLedger',
						'startedAt',
						'state'
					]),
		ledgerCloseMeta:
			source.ledgerCloseMeta === null || source.ledgerCloseMeta === undefined
				? null
				: sanitizeLedgerCloseMetaCoverage(source.ledgerCloseMeta),
		ledgerCloseMetaState:
			source.ledgerCloseMetaState === undefined
				? createEmptyFullHistoryLedgerCloseMetaStateStatus()
				: sanitizeFullHistoryLedgerCloseMetaStateStatus(
						source.ledgerCloseMetaState
					),
		historicalBackfill:
			source.historicalBackfill === null
				? null
				: sanitizeHistoricalBackfill(source.historicalBackfill)
	};
}

function sanitizeHistoricalBackfill(value: unknown): Record<string, unknown> {
	const source = record(value);
	const sanitized = pick(source, [
		'failedJobs',
		'latestErrorCode',
		'nextCheckpointLedger',
		'pendingJobs',
		'runningJobs',
		'state',
		'updatedAt'
	]);
	if (!Object.hasOwn(source, 'completedJobs')) return sanitized;
	return {
		...sanitized,
		...pick(source, ['completedCheckpoints', 'completedJobs']),
		currentProof:
			source.currentProof === null
				? null
				: pick(source.currentProof, [
						'checkpointLedger',
						'expectedBucketCount',
						'failureKind',
						'remainingBucketCount',
						'status',
						'verifiedBucketCount'
					])
	};
}

function sanitizeLedgerCloseMetaCoverage(
	value: unknown
): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, [
			'batchCount',
			'firstAvailableLedger',
			'firstLedger',
			'lastLedger',
			'ledgerCount',
			'nextLedger',
			'sourceCount',
			'updatedAt'
		]),
		outputs: array(source.outputs).map((output) =>
			pick(output, [
				'batchCount',
				'dataset',
				'outputBytes',
				'recordCount',
				'schemaVersions'
			])
		)
	};
}

function sanitizeArchiveSummary(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, [
			'activeObjectChecks',
			'archiveEvidenceFailures',
			'generatedAt',
			'scannerIssueFailures',
			'sourceCount',
			'sourceLimit',
			'sourcesTruncated',
			'unclassifiedFailures'
		]),
		checkpointCoverage: pick(source.checkpointCoverage, [
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
		]),
		sources: array(source.sources).map((entry) =>
			pick(entry, [
				'activeObjectChecks',
				'archiveEvidenceFailures',
				'archiveUrl',
				'archiveUrlIdentity',
				'currentLedger',
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
			])
		)
	};
}

function sanitizeArchiveEvents(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, ['count', 'generatedAt', 'limit']),
		events: array(source.events).map((entry) => {
			const event = record(entry);
			return {
				...pick(event, [
					'archiveUrl',
					'archiveUrlIdentity',
					'bucketHash',
					'bytesDownloaded',
					'checkpointLedger',
					'claimAttempt',
					'createdAt',
					'eventType',
					'evidenceClass',
					'nextAttemptAt',
					'objectKey',
					'objectRemoteId',
					'objectType',
					'objectUrl',
					'remoteId',
					'verificationFacts',
					'workerStage'
				]),
				error:
					event.error === null
						? null
						: pick(event.error, ['httpStatus', 'message', 'type'])
			};
		})
	};
}

function sanitizeDataQuality(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, ['generatedAt', 'status']),
		archiveQueue: pick(source.archiveQueue, [
			'activeJobs',
			'deprecated',
			'drivesPlatformStatus',
			'drivesRuntimeHealth',
			'generatedAt',
			'historical',
			'pendingJobs',
			'source',
			'staleJobAgeMs',
			'staleJobs',
			'status',
			'totalUnfinishedJobs'
		]),
		dataFreshness: sanitizeFreshness(source.dataFreshness),
		rollups: sanitizeRollups(source.rollups),
		scans: sanitizeScans(source.scans)
	};
}

function sanitizeFreshness(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, ['generatedAt', 'status']),
		archiveEvidence: pick(source.archiveEvidence, [
			'ageMs',
			'drivesPlatformStatus',
			'drivesRuntimeHealth',
			'latestAt',
			'source',
			'staleAfterMs',
			'status'
		]),
		archiveScan: pick(source.archiveScan, [
			'ageMs',
			'deprecated',
			'drivesPlatformStatus',
			'drivesRuntimeHealth',
			'historical',
			'latestAt',
			'source',
			'staleAfterMs',
			'status'
		]),
		networkScan: pick(source.networkScan, [
			'ageMs',
			'latestAt',
			'staleAfterMs',
			'status'
		])
	};
}

function sanitizeScans(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, ['generatedAt', 'status']),
		networkScan: pick(source.networkScan, [
			'completedScans',
			'completionRate',
			'expectedCompletionRate',
			'expectedScans',
			'incompleteScans',
			'latestCompletedScanAt',
			'latestScanAt',
			'scanIntervalMs',
			'status',
			'totalScans',
			'windowEnd',
			'windowMs',
			'windowStart'
		])
	};
}

function sanitizeRollups(value: unknown): Record<string, unknown> {
	const source = record(value);
	const network = record(source.networkRollups);
	return {
		...pick(source, ['generatedAt', 'status']),
		networkRollups: {
			...pick(network, [
				'daysWithCompletedScans',
				'daysWithRollups',
				'latestRollupDay',
				'matchingDays',
				'mismatchedRollupDays',
				'missingRollupDays',
				'rawCompletedScans',
				'rollupCrawlCount',
				'status',
				'windowDays',
				'windowEnd',
				'windowStart'
			]),
			...(Object.hasOwn(network, 'days')
				? {
						days: array(network.days).map((day) =>
							pick(day, [
								'day',
								'hasRollup',
								'matchesRawCompletedScans',
								'rawCompletedScans',
								'rollupCrawlCount',
								'status'
							])
						)
					}
				: {})
		}
	};
}

function sanitizeScanLogs(value: unknown): Record<string, unknown> {
	const source = record(value);
	return {
		...pick(source, [
			'archiveScansDeprecated',
			'archiveScansHistorical',
			'generatedAt',
			'limit'
		]),
		archiveScans: array(source.archiveScans).map(sanitizeArchiveScanLog),
		networkScans: array(source.networkScans).map((entry) => {
			const scan = record(entry);
			return {
				...pick(scan, [
					'completed',
					'latestLedger',
					'latestLedgerCloseTime',
					'ledgersCount',
					'status',
					'time'
				]),
				archiveScheduling: pick(scan.archiveScheduling, [
					'discoveredArchiveUrlCount',
					'duplicateSuppressedArchiveScanJobCount',
					'scheduledArchiveScanJobCount',
					'schedulerErrorCount'
				])
			};
		})
	};
}

function sanitizeArchiveScanLog(value: unknown): Record<string, unknown> {
	const scan = record(value);
	return {
		...pick(scan, [
			'concurrency',
			'durationMs',
			'endDate',
			'errorCount',
			'fromLedger',
			'hasArchiveVerificationError',
			'hasWorkerIssue',
			'latestAttemptedLedger',
			'latestScannedLedger',
			'latestVerifiedLedger',
			'scanStatus',
			'startDate',
			'toLedger',
			'url'
		]),
		errors: array(scan.errors).map((error) =>
			pick(error, ['message', 'type', 'url'])
		)
	};
}

function pick(
	value: unknown,
	fields: readonly string[]
): Record<string, unknown> {
	const source = record(value);
	const result: Record<string, unknown> = {};
	for (const field of fields) {
		if (Object.hasOwn(source, field)) result[field] = source[field];
	}
	return result;
}

function record(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('Validated status payload changed shape');
	}
	return value as Record<string, unknown>;
}

function array(value: unknown): readonly unknown[] {
	if (!Array.isArray(value)) {
		throw new Error('Validated status payload array changed shape');
	}
	return value;
}
