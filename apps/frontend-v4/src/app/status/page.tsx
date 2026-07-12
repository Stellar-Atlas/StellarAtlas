import { Suspense } from 'react';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFrontendStatus,
	fetchFullHistoryStatus,
	fetchWorkerStatus
} from '@api/client';
import { fetchHistoryArchiveObjectStatusSummary } from '@api/archive-scans-client';
import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveStatusSummary,
	PublicFullHistoryStatus,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { StatusDashboardLive } from '@components/status/status-dashboard-live';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
const headlineFetchOptions = { cache: 'no-store', timeoutMs: 3_500 } as const;

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const emptyArchiveObjects = buildEmptyArchiveQueue();
	const generatedAt = new Date().toISOString();
	const archiveEvents = buildEmptyArchiveEvents(generatedAt);
	const scanLogs = buildEmptyScanLogs(generatedAt);
	const [api, dataQuality, workers, frontend, fullHistory, archiveSummary] =
		await Promise.all([
			fetchOptional(
				fetchApiStatus(headlineFetchOptions),
				buildUnavailableApi(generatedAt)
			),
			fetchOptional(
				fetchDataQualityStatus(headlineFetchOptions),
				buildUnavailableDataQuality(generatedAt)
			),
			fetchOptional(
				fetchWorkerStatus(headlineFetchOptions),
				buildUnavailableWorkers(generatedAt)
			),
			fetchOptional(
				fetchFrontendStatus(headlineFetchOptions),
				buildUnavailableFrontend(generatedAt)
			),
			fetchOptional(
				fetchFullHistoryStatus(headlineFetchOptions),
				buildUnavailableFullHistory(generatedAt)
			),
			fetchOptional(
				fetchHistoryArchiveObjectStatusSummary(headlineFetchOptions),
				buildUnavailableArchiveStatus(generatedAt)
			)
		]);

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, network scan records, archive evidence checks, scanner runtime, and archive activity."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboardLive
				api={api.value}
				archiveEvents={archiveEvents}
				archiveEventsAvailable={false}
				archiveEvidenceAvailable={archiveSummary.available}
				archiveObjects={emptyArchiveObjects}
				archiveObjectsAvailable={false}
				archiveSummary={archiveSummary.value}
				dataQuality={dataQuality.value}
				frontend={frontend.value}
				fullHistory={fullHistory.value}
				scanLogs={scanLogs}
				scanLogsAvailable={false}
				workers={workers.value}
			/>
		</main>
	);
}

function buildUnavailableFullHistory(
	generatedAt: string
): PublicFullHistoryStatus {
	return {
		canonicalCoverage: null,
		canonicalPromotion: null,
		earliestParsedLedger: null,
		generatedAt,
		latestObservedAt: null,
		latestParsedLedger: null,
		localAssetIndexReady: false,
		localContractIndexReady: false,
		localOperationIndexReady: false,
		localTransactionIndexReady: false,
		mode: 'archive_header_parser',
		parsedLedgerCount: null,
		sourceArchiveCount: null,
		status: 'unavailable'
	};
}

async function fetchOptional<T>(
	promise: Promise<T>,
	fallback: T
): Promise<{ readonly available: boolean; readonly value: T }> {
	try {
		return {
			available: true,
			value: await promise
		};
	} catch {
		return {
			available: false,
			value: fallback
		};
	}
}

function buildUnavailableApi(generatedAt: string): PublicApiStatus {
	return {
		generatedAt,
		service: 'api',
		status: 'unavailable'
	};
}

function buildUnavailableFrontend(
	generatedAt: string
): PublicConfiguredServiceStatus {
	return {
		configured: false,
		configurationState: 'not_configured',
		generatedAt,
		health: 'not_probed',
		probe: 'not_run',
		readiness: 'planned',
		requiredForProduction: true,
		service: 'frontend',
		status: 'unavailable',
		url: null
	};
}

function buildUnavailableWorkers(generatedAt: string): PublicWorkerStatus {
	return {
		archiveWorkers: {
			activeWorkers: 0,
			configuredWorkerProcesses: 0,
			freshWorkers: 0,
			idleWorkers: 0,
			lastHeartbeatAt: null,
			missingWorkers: 0,
			queueActiveWorkers: 0,
			queueStaleWorkers: 0,
			registeredWorkers: 0,
			startupGraceActive: false,
			startupGraceMs: 120_000,
			staleJobAgeMs: 0,
			staleWorkers: 0,
			status: 'unavailable',
			telemetryMode: 'aggregate-only',
			totalTakenJobs: 0,
			workers: []
		},
		communityScanners: {
			activeScanners: 0,
			blacklistedScanners: 0,
			degradedScanners: 0,
			heartbeatFreshnessMs: 0,
			offlineScanners: 0,
			status: 'unavailable',
			totalScanners: 0
		},
		generatedAt,
		status: 'unavailable'
	};
}

function buildEmptyScanLogs(generatedAt: string): PublicScanLogStatus {
	return {
		archiveScans: [],
		archiveScansDeprecated: true,
		archiveScansHistorical: true,
		generatedAt,
		limit: 25,
		networkScans: []
	};
}

function buildUnavailableDataQuality(
	generatedAt: string
): PublicDataQualityStatus {
	const archiveEvidence = {
		...buildUnavailableFreshnessProbe(),
		drivesPlatformStatus: false as const,
		drivesRuntimeHealth: false as const,
		source: 'archive_object_evidence' as const
	};
	return {
		archiveQueue: {
			activeJobs: 0,
			generatedAt,
			pendingJobs: 0,
			staleJobAgeMs: 0,
			staleJobs: 0,
			status: 'unavailable',
			totalUnfinishedJobs: 0
		},
		dataFreshness: {
			archiveEvidence,
			archiveScan: {
				...buildUnavailableFreshnessProbe(),
				deprecated: true,
				drivesPlatformStatus: false,
				drivesRuntimeHealth: false,
				historical: true,
				source: 'legacy_range_scan'
			},
			generatedAt,
			networkScan: buildUnavailableFreshnessProbe(),
			status: 'unavailable'
		},
		generatedAt,
		rollups: {
			generatedAt,
			networkRollups: {
				daysWithCompletedScans: 0,
				daysWithRollups: 0,
				latestRollupDay: null,
				matchingDays: 0,
				mismatchedRollupDays: 0,
				missingRollupDays: 0,
				rawCompletedScans: 0,
				rollupCrawlCount: 0,
				status: 'unavailable',
				windowDays: 0,
				windowEnd: generatedAt,
				windowStart: generatedAt
			},
			status: 'unavailable'
		},
		scans: {
			generatedAt,
			networkScan: {
				completedScans: 0,
				completionRate: null,
				expectedCompletionRate: null,
				expectedScans: 0,
				incompleteScans: 0,
				latestCompletedScanAt: null,
				latestScanAt: null,
				scanIntervalMs: 0,
				status: 'unavailable',
				totalScans: 0,
				windowEnd: generatedAt,
				windowMs: 0,
				windowStart: generatedAt
			},
			status: 'unavailable'
		},
		status: 'unavailable'
	};
}

function buildUnavailableFreshnessProbe() {
	return {
		ageMs: null,
		latestAt: null,
		staleAfterMs: null,
		status: 'unavailable' as const
	};
}

function buildUnavailableArchiveStatus(
	generatedAt: string
): PublicHistoryArchiveStatusSummary {
	return {
		activeObjectChecks: 0,
		archiveEvidenceFailures: 0,
		checkpointCoverage: {
			activeArchiveCheckpoints: 0,
			archiveRootsWithState: 0,
			categoryConsistencyFailedCheckpoints: 0,
			categoryConsistencyNotEvaluatedCheckpoints: 0,
			categoryConsistencyPendingCheckpoints: 0,
			categoryConsistentArchiveCheckpoints: 0,
			completeArchiveCheckpoints: 0,
			discoveryCompleteArchiveRoots: 0,
			expectedArchiveCheckpoints: 0,
			failedArchiveCheckpoints: 0,
			latestCheckpointLedger: null,
			missingArchiveCheckpoints: 0,
			objectCompleteArchiveCheckpoints: 0,
			oldestCheckpointLedger: null,
			partialArchiveCheckpoints: 0,
			totalArchiveCheckpoints: 0
		},
		generatedAt,
		sourceCount: 0,
		sourceLimit: 256,
		scannerIssueFailures: 0,
		sources: [],
		sourcesTruncated: false,
		unclassifiedFailures: 0
	};
}

function buildEmptyArchiveEvents(
	generatedAt: string
): PublicHistoryArchiveObjectEvents {
	return {
		count: 0,
		events: [],
		generatedAt,
		limit: 100
	};
}

function buildEmptyArchiveQueue(): PublicHistoryArchiveObjectQueue {
	return {
		activeObjects: 0,
		failedObjects: 0,
		generatedAt: new Date().toISOString(),
		objects: [],
		pendingObjects: 0,
		verifiedObjects: 0
	};
}

export default function StatusPage(): React.JSX.Element {
	return (
		<Suspense fallback={<RouteLoadingPanel />}>
			<StatusRouteContent />
		</Suspense>
	);
}
