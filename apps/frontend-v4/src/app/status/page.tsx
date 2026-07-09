import { Suspense } from 'react';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFrontendStatus,
	fetchScanLogStatus,
	fetchWorkerStatus
} from '@api/client';
import {
	fetchHistoryArchiveObjectEvents,
	fetchHistoryArchiveObjectSummary
} from '@api/archive-scans-client';
import type {
	PublicApiStatus,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { StatusDashboardLive } from '@components/status/status-dashboard-live';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
const statusFetchOptions = { cache: 'no-store', timeoutMs: 15_000 } as const;
const archiveSampleFetchOptions = {
	cache: 'no-store',
	timeoutMs: 3_500
} as const;

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const emptyArchiveObjects = buildEmptyArchiveQueue();
	const generatedAt = new Date().toISOString();
	const [
		api,
		dataQuality,
		scanLogs,
		workers,
		frontend,
		archiveEvents,
		archiveSummary
	] =
		await Promise.all([
			fetchOptional(
				fetchApiStatus(statusFetchOptions),
				buildUnavailableApi(generatedAt)
			),
			fetchOptional(
				fetchDataQualityStatus(statusFetchOptions),
				buildUnavailableDataQuality(generatedAt)
			),
			fetchOptional(
				fetchScanLogStatus(statusFetchOptions),
				buildEmptyScanLogs(generatedAt)
			),
			fetchOptional(
				fetchWorkerStatus(statusFetchOptions),
				buildUnavailableWorkers(generatedAt)
			),
			fetchOptional(
				fetchFrontendStatus(statusFetchOptions),
				buildUnavailableFrontend(generatedAt)
			),
			fetchOptional(
				fetchHistoryArchiveObjectEvents(100, archiveSampleFetchOptions),
				buildEmptyArchiveEvents()
			),
			fetchOptional(
				fetchHistoryArchiveObjectSummary(archiveSampleFetchOptions),
				buildArchiveSummaryFromQueue(emptyArchiveObjects)
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
				archiveEvents={archiveEvents.value}
				archiveEvidenceAvailable={archiveSummary.available}
				archiveObjects={emptyArchiveObjects}
				archiveObjectsAvailable={false}
				archiveSummary={archiveSummary.value}
				dataQuality={dataQuality.value}
				frontend={frontend.value}
				scanLogs={scanLogs.value}
				workers={workers.value}
			/>
		</main>
	);
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
			staleJobAgeMs: 0,
			staleWorkers: 0,
			status: 'unavailable',
			totalTakenJobs: 0
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
		generatedAt,
		limit: 25,
		networkScans: []
	};
}

function buildUnavailableDataQuality(
	generatedAt: string
): PublicDataQualityStatus {
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
			archiveScan: buildUnavailableFreshnessProbe(),
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

function buildArchiveSummaryFromQueue(
	objects: PublicHistoryArchiveObjectQueue
): PublicHistoryArchiveObjectSummary {
	const bucketObjects = objects.objects.filter(
		(object) => object.objectType === 'bucket'
	);
	const uniqueBucketHashes = new Set(
		bucketObjects.flatMap((object) =>
			object.bucketHash === null ? [] : [object.bucketHash]
		)
	);

	return {
		activeObjects: objects.activeObjects,
		archiveUrl: null,
		archiveUrlIdentity: null,
		buckets: {
			activeBucketObjects: countBucketStatus(bucketObjects, 'scanning'),
			failedBucketObjects: countBucketStatus(bucketObjects, 'failed'),
			pendingBucketObjects: countBucketStatus(bucketObjects, 'pending'),
			totalBucketObjects: bucketObjects.length,
			uniqueBucketHashes: uniqueBucketHashes.size,
			verifiedBucketObjects: countBucketStatus(bucketObjects, 'verified')
		},
		checkpoints: {
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
		failedObjects: objects.failedObjects,
		generatedAt: objects.generatedAt,
		hostThrottles: [],
		objectTypes: [],
		pendingObjects: objects.pendingObjects,
		scope: 'global',
		sources: [],
		totalObjects:
			objects.activeObjects +
			objects.pendingObjects +
			objects.verifiedObjects +
			objects.failedObjects,
		verifiedObjects: objects.verifiedObjects
	};
}

function countBucketStatus(
	bucketObjects: PublicHistoryArchiveObjectQueue['objects'],
	status: PublicHistoryArchiveObjectQueue['objects'][number]['status']
): number {
	return bucketObjects.filter((object) => object.status === status).length;
}

function buildEmptyArchiveEvents(): PublicHistoryArchiveObjectEvents {
	return {
		count: 0,
		events: [],
		generatedAt: new Date().toISOString(),
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
