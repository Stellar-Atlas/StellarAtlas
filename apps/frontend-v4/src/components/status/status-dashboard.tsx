import type {
	PublicApiStatus,
	PublicHistoryArchiveBucketCrossCoverage,
	PublicHistoryArchiveObjectEvents,
	PublicHistoryArchiveObjectQueue,
	PublicHistoryArchiveObjectSummary,
	PublicConfiguredServiceStatus,
	PublicDataQualityStatus,
	PublicStatusLevel,
	PublicScanLogStatus,
	PublicWorkerStatus
} from '@api/types';
import {
	formatDateTime,
	formatInteger,
	formatPercent
} from '@format/formatters';
import { StatCard } from '../stat-card';
import { HistoryArchiveObjectEventLog } from '@components/archive-scans/history-archive-object-event-log';
import { HistoryArchiveObjectCoverage } from '@components/archive-scans/history-archive-object-coverage';
import { HistoryArchiveObjectInventory } from '@components/archive-scans/history-archive-object-inventory';
import { RecentScanLogs } from './recent-scan-logs';
import { StatusPill, StatusRow, statusLabel, statusTone } from './status-ui';

interface StatusDashboardProps {
	readonly api: PublicApiStatus;
	readonly archiveBucketCoverages: readonly PublicHistoryArchiveBucketCrossCoverage[];
	readonly archiveEvents: PublicHistoryArchiveObjectEvents;
	readonly archiveObjects: PublicHistoryArchiveObjectQueue;
	readonly archiveSummary: PublicHistoryArchiveObjectSummary;
	readonly dataQuality: PublicDataQualityStatus;
	readonly frontend: PublicConfiguredServiceStatus;
	readonly scanLogs: PublicScanLogStatus;
	readonly workers: PublicWorkerStatus;
}

export function StatusDashboard({
	api,
	archiveBucketCoverages,
	archiveEvents,
	archiveObjects,
	archiveSummary,
	dataQuality,
	frontend,
	scanLogs,
	workers
}: StatusDashboardProps): React.JSX.Element {
	const scan = dataQuality.scans.networkScan;
	const rollups = dataQuality.rollups.networkRollups;
	const archiveObjectActivity = summarizeArchiveObjects(archiveObjects);
	const archiveVerifierDetail = `${formatInteger(archiveObjectActivity.freshActiveObjects)} checking now, ${formatInteger(archiveObjectActivity.staleActiveObjects)} delayed, ${formatInteger(archiveSummary.pendingObjects)} waiting`;
	const archiveCoverageText = formatArchiveVerificationCoverage(archiveSummary);
	const showCommunityScanners =
		workers.communityScanners.activeScanners > 0 ||
		workers.communityScanners.offlineScanners > 0 ||
		workers.communityScanners.degradedScanners > 0;
	const frontendApiStatus = criticalRuntimeStatus(api.status, frontend.configured);

	return (
		<div className="status-dashboard">
			<div className="stats-grid">
				<StatCard
					detail={`API checked ${formatDateTime(api.generatedAt)}`}
					label="Frontend / API"
					tone={statusTone(frontendApiStatus)}
					value={statusLabel(frontendApiStatus)}
				/>
				<StatCard
					detail={`${formatInteger(scan.incompleteScans)} incomplete recorded rows`}
					label="Network scans"
					tone={statusTone(scan.status)}
					value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)} complete`}
				/>
				<StatCard
					detail={`${formatInteger(archiveSummary.verifiedObjects)} of ${formatInteger(archiveSummary.totalObjects)} verified; ${formatInteger(archiveSummary.failedObjects)} evidence failures`}
					label="Archive verification"
					tone={statusTone(archiveObjectActivity.status)}
					value={archiveCoverageText}
				/>
				<StatCard
					detail={archiveVerifierDetail}
					label="Archive work"
					tone={statusTone(archiveObjectActivity.workerStatus)}
					value={`${formatInteger(archiveSummary.activeObjects)} checking`}
				/>
			</div>

			<div className="status-panel-grid">
				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Data Freshness</strong>
							<span>{statusLabel(dataQuality.dataFreshness.status)}</span>
						</div>
						<StatusPill status={dataQuality.dataFreshness.status} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={`Age ${formatDuration(dataQuality.dataFreshness.networkScan.ageMs)}`}
							label="Network scan"
							status={dataQuality.dataFreshness.networkScan.status}
							value={formatNullableDate(
								dataQuality.dataFreshness.networkScan.latestAt
							)}
						/>
						<StatusRow
							detail={archiveVerifierDetail}
							label="Archive work"
							status={archiveObjectActivity.workerStatus}
							value={`${formatInteger(archiveSummary.activeObjects)} checking`}
						/>
						<StatusRow
							detail={`${formatInteger(scan.completedScans)} completed, ${formatInteger(scan.incompleteScans)} incomplete`}
							label="Network scanner records"
							status={scan.status}
							value={`${formatInteger(scan.completedScans)} / ${formatInteger(scan.totalScans)}`}
						/>
						<StatusRow
							detail={`${formatInteger(rollups.rawCompletedScans)} completed scans summarized into ${formatInteger(rollups.rollupCrawlCount)} daily snapshots`}
							label="Network history snapshots"
							status={rollups.status}
							value={`${formatInteger(rollups.matchingDays)} days`}
						/>
					</div>
				</section>

				<section className="panel">
					<div className="panel-heading">
						<div>
							<strong>Scanner Work</strong>
							<span>{formatDateTime(workers.generatedAt)}</span>
						</div>
						<StatusPill status={archiveObjectActivity.status} />
					</div>
					<div className="status-list">
						<StatusRow
							detail={`${formatInteger(archiveSummary.failedObjects)} failures, ${formatInteger(archiveSummary.verifiedObjects)} verified`}
							label="Archive checks"
							status={archiveObjectActivity.status}
							value={`${formatInteger(archiveObjectActivity.pendingOrActiveObjects)} open`}
						/>
						<StatusRow
							detail={`${formatInteger(archiveObjectActivity.freshActiveObjects)} current, ${formatInteger(archiveObjectActivity.staleActiveObjects)} delayed after ${formatDuration(ARCHIVE_OBJECT_STALE_AGE_MS)}`}
							label="Archive workers"
							status={archiveObjectActivity.workerStatus}
							value={`${formatInteger(archiveSummary.activeObjects)} checking`}
						/>
						{showCommunityScanners ? (
							<StatusRow
								detail={`${formatInteger(workers.communityScanners.offlineScanners)} offline, ${formatInteger(workers.communityScanners.degradedScanners)} degraded`}
								label="External scanner clients"
								status={workers.communityScanners.status}
								value={`${formatInteger(workers.communityScanners.activeScanners)} active`}
							/>
						) : null}
					</div>
				</section>

				<HistoryArchiveObjectCoverage
					proofOpen={false}
					summary={archiveSummary}
					title="Archive verification coverage"
				/>

				<HistoryArchiveObjectInventory
					bucketCoverages={archiveBucketCoverages}
					objects={archiveObjects}
					priorityOpen={false}
					showHelperCopy={false}
					title="Archive work queue"
				/>

				<HistoryArchiveObjectEventLog
					events={archiveEvents}
					title="Recent archive file activity"
				/>

				<RecentScanLogs scanLogs={scanLogs} />
			</div>
		</div>
	);
}

const ARCHIVE_OBJECT_STALE_AGE_MS = 2 * 60 * 1000;

interface ArchiveObjectSummary {
	readonly freshActiveObjects: number;
	readonly staleActiveObjects: number;
	readonly status: PublicStatusLevel;
	readonly pendingOrActiveObjects: number;
	readonly workerStatus: PublicStatusLevel;
}

function summarizeArchiveObjects(
	objects: PublicHistoryArchiveObjectQueue
): ArchiveObjectSummary {
	const generatedAtMs = Date.parse(objects.generatedAt);
	const staleActiveObjects = objects.objects.filter((object) => {
		if (object.status !== 'scanning') return false;
		const updatedAtMs = Date.parse(object.updatedAt);
		return (
			Number.isFinite(generatedAtMs) &&
			Number.isFinite(updatedAtMs) &&
			generatedAtMs - updatedAtMs > ARCHIVE_OBJECT_STALE_AGE_MS
		);
	}).length;
	const freshActiveObjects = Math.max(
		0,
		objects.activeObjects - staleActiveObjects
	);
	const status: PublicStatusLevel =
		objects.failedObjects > 0 || staleActiveObjects > 0 ? 'degraded' : 'ok';
	const workerStatus: PublicStatusLevel =
		staleActiveObjects > 0 ? 'degraded' : 'ok';

	return {
		freshActiveObjects,
		staleActiveObjects,
		status,
		pendingOrActiveObjects: objects.activeObjects + objects.pendingObjects,
		workerStatus
	};
}

function formatArchiveVerificationCoverage(
	summary: PublicHistoryArchiveObjectSummary
): string {
	if (summary.totalObjects <= 0) return '0% verified';

	return (
		formatPercent((summary.verifiedObjects / summary.totalObjects) * 100) +
		' verified'
	);
}

function criticalRuntimeStatus(
	apiStatus: PublicStatusLevel,
	frontendConfigured: boolean
): PublicStatusLevel {
	if (!frontendConfigured || apiStatus === 'unavailable') return 'unavailable';
	if (apiStatus === 'degraded') return 'degraded';
	return 'ok';
}

function formatNullableDate(value: string | null): string {
	return value === null ? 'No data' : formatDateTime(value);
}

function formatDuration(value: number | null): string {
	if (value === null) return 'unknown';
	const minutes = Math.round(value / 60000);
	if (minutes < 60) return `${formatInteger(minutes)} min`;
	return `${formatInteger(Math.round(minutes / 60))} hr`;
}
