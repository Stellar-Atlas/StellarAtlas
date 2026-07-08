import { Suspense } from 'react';
import { fetchHistoryArchiveObjectEvents } from '@api/archive-scans-client';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFrontendStatus,
	fetchHistoryArchiveObjectSummary,
	fetchHistoryArchiveObjects,
	fetchScanLogStatus,
	fetchWorkerStatus
} from '@api/client';
import type {
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary
} from '@api/types';
import { PageHeading } from '@components/layout/page-heading';
import { RouteLoadingPanel } from '@components/layout/route-fallbacks';
import { StatusDashboardLive } from '@components/status/status-dashboard-live';

export const revalidate = 0;
export const dynamic = 'force-dynamic';
const statusFetchOptions = { cache: 'no-store' } as const;
const archiveSummaryFetchOptions = {
	cache: 'no-store',
	timeoutMs: 30000
} as const;
const archiveDetailFetchOptions = {
	cache: 'no-store',
	timeoutMs: 12000
} as const;
type FetchResult<T> =
	| {
			readonly ok: true;
			readonly value: T;
	  }
	| {
			readonly ok: false;
			readonly value: T;
	  };

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const [
		api,
		dataQuality,
		scanLogs,
		workers,
		archiveEventsResult,
		archiveSummaryResult,
		archiveObjectsResult,
		frontend
	] = await Promise.all([
		fetchApiStatus(statusFetchOptions),
		fetchDataQualityStatus(statusFetchOptions),
		fetchScanLogStatus(statusFetchOptions),
		fetchWorkerStatus(statusFetchOptions),
		withFallback(
			fetchHistoryArchiveObjectEvents(100, archiveDetailFetchOptions),
			buildEmptyArchiveEvents()
		),
		withFallback<PublicHistoryArchiveObjectSummary | null>(
			fetchHistoryArchiveObjectSummary(archiveSummaryFetchOptions),
			null
		),
		withFallback(
			fetchHistoryArchiveObjects(100, archiveDetailFetchOptions),
			buildEmptyArchiveQueue()
		),
		fetchFrontendStatus(statusFetchOptions)
	]);
	const archiveObjects = archiveObjectsResult.value;
	const archiveSummary =
		archiveSummaryResult.value ?? buildArchiveSummaryFromQueue(archiveObjects);
	const archiveEvidenceAvailable =
		archiveSummaryResult.ok && archiveSummaryResult.value !== null;

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, network scan records, archive evidence checks, scanner runtime, and archive activity."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboardLive
				api={api}
				archiveEvents={archiveEventsResult.value}
				archiveEvidenceAvailable={archiveEvidenceAvailable}
				archiveObjects={archiveObjects}
				archiveObjectsAvailable={archiveObjectsResult.ok}
				archiveSummary={archiveSummary}
				dataQuality={dataQuality}
				frontend={frontend}
				scanLogs={scanLogs}
				workers={workers}
			/>
		</main>
	);
}

async function withFallback<T>(
	promise: Promise<T>,
	value: T
): Promise<FetchResult<T>> {
	try {
		return { ok: true, value: await promise };
	} catch {
		return { ok: false, value };
	}
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

function buildEmptyArchiveEvents() {
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
