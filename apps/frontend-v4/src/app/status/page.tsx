import { Suspense } from 'react';
import {
	fetchApiStatus,
	fetchDataQualityStatus,
	fetchFrontendStatus,
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

async function StatusRouteContent(): Promise<React.JSX.Element> {
	const [api, dataQuality, scanLogs, workers, frontend] = await Promise.all([
		fetchApiStatus(statusFetchOptions),
		fetchDataQualityStatus(statusFetchOptions),
		fetchScanLogStatus(statusFetchOptions),
		fetchWorkerStatus(statusFetchOptions),
		fetchFrontendStatus(statusFetchOptions)
	]);
	const archiveEvents = buildEmptyArchiveEvents();
	const archiveObjects = buildEmptyArchiveQueue();
	const archiveSummary = buildArchiveSummaryFromQueue(archiveObjects);

	return (
		<main className="shell">
			<PageHeading
				description="Current public API, network scan records, archive evidence checks, scanner runtime, and archive activity."
				eyebrow="Operations"
				title="Status"
			/>
			<StatusDashboardLive
				api={api}
				archiveEvents={archiveEvents}
				archiveEvidenceAvailable={false}
				archiveObjects={archiveObjects}
				archiveObjectsAvailable={false}
				archiveSummary={archiveSummary}
				dataQuality={dataQuality}
				frontend={frontend}
				scanLogs={scanLogs}
				workers={workers}
			/>
		</main>
	);
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
